#!/usr/bin/env python3
"""Build and incrementally update the CCB fleet SQLite database.

Only Python's standard library is required.  The importer intentionally mirrors
the browser parser: tab-delimited Event Log rows, MM:DD:YYYY::HH:MM:SS dates,
raw pressure values divided by ten (PSI), and PSI converted to kg/cm2.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import sys
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


PSI_TO_KG_CM2 = 0.0703069579
PRESSURE_FIELDS = ("mrt", "bpt", "bpalt", "ert", "tl20", "tt20", "t10", "bct", "flt")
TIMESTAMP_RE = re.compile(r"^(\d{1,2}):(\d{1,2}):(\d{4})::(\d{1,2}):(\d{2}):(\d{2})$")


SCHEMA = r"""
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS locomotives (
    locomotive_id INTEGER PRIMARY KEY,
    locomotive_number TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_imported_at TEXT
);

CREATE TABLE IF NOT EXISTS import_runs (
    import_run_id INTEGER PRIMARY KEY,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT,
    source_root TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    txt_files_found INTEGER NOT NULL DEFAULT 0,
    files_imported INTEGER NOT NULL DEFAULT 0,
    files_duplicate INTEGER NOT NULL DEFAULT 0,
    files_invalid INTEGER NOT NULL DEFAULT 0,
    event_rows_read INTEGER NOT NULL DEFAULT 0,
    event_rows_inserted INTEGER NOT NULL DEFAULT 0,
    event_rows_duplicate INTEGER NOT NULL DEFAULT 0,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS import_files (
    import_file_id INTEGER PRIMARY KEY,
    import_run_id INTEGER NOT NULL REFERENCES import_runs(import_run_id) ON DELETE CASCADE,
    report_id INTEGER,
    locomotive_number_detected TEXT,
    locomotive_source TEXT,
    source_path TEXT NOT NULL,
    source_relative_path TEXT NOT NULL,
    source_filename TEXT NOT NULL,
    file_sha256 TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    status TEXT NOT NULL,
    parsed_event_rows INTEGER NOT NULL DEFAULT 0,
    inserted_event_rows INTEGER NOT NULL DEFAULT 0,
    duplicate_event_rows INTEGER NOT NULL DEFAULT 0,
    malformed_event_rows INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reports (
    report_id INTEGER PRIMARY KEY,
    locomotive_id INTEGER NOT NULL REFERENCES locomotives(locomotive_id),
    source_filename TEXT NOT NULL,
    source_path TEXT NOT NULL,
    file_sha256 TEXT NOT NULL,
    software_version TEXT,
    first_event_at TEXT,
    last_event_at TEXT,
    parsed_event_count INTEGER NOT NULL DEFAULT 0,
    stored_event_count INTEGER NOT NULL DEFAULT 0,
    duplicate_event_count INTEGER NOT NULL DEFAULT 0,
    malformed_event_count INTEGER NOT NULL DEFAULT 0,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (locomotive_id, file_sha256)
);

CREATE TABLE IF NOT EXISTS event_occurrences (
    occurrence_id INTEGER PRIMARY KEY,
    locomotive_id INTEGER NOT NULL REFERENCES locomotives(locomotive_id),
    occurrence_start_at TEXT NOT NULL,
    event_code_normalized TEXT NOT NULL,
    event_state_normalized TEXT NOT NULL,
    event_timestamp TEXT NOT NULL,
    event_code TEXT NOT NULL,
    fault_name TEXT NOT NULL,
    cleared_at TEXT,
    duration_seconds INTEGER,
    resolution_status TEXT,
    first_report_id INTEGER NOT NULL REFERENCES reports(report_id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (locomotive_id, occurrence_start_at, event_code_normalized, event_state_normalized)
);

CREATE TABLE IF NOT EXISTS event_log (
    event_log_id INTEGER PRIMARY KEY,
    occurrence_id INTEGER NOT NULL UNIQUE REFERENCES event_occurrences(occurrence_id) ON DELETE CASCADE,
    report_id INTEGER NOT NULL REFERENCES reports(report_id),
    source_record_number TEXT,
    source_line_number INTEGER,
    event_timestamp TEXT NOT NULL,
    event_date TEXT NOT NULL,
    event_time TEXT NOT NULL,
    event_code TEXT NOT NULL,
    description TEXT NOT NULL,
    state TEXT NOT NULL,
    mode TEXT,
    timestamp_raw TEXT
);

CREATE TABLE IF NOT EXISTS event_environment (
    event_log_id INTEGER PRIMARY KEY REFERENCES event_log(event_log_id) ON DELETE CASCADE,
    mrt_raw TEXT, mrt_psi REAL, mrt_kg_cm2 REAL,
    bpt_raw TEXT, bpt_psi REAL, bpt_kg_cm2 REAL,
    bpalt_raw TEXT, bpalt_psi REAL, bpalt_kg_cm2 REAL,
    ert_raw TEXT, ert_psi REAL, ert_kg_cm2 REAL,
    tl20_raw TEXT, tl20_psi REAL, tl20_kg_cm2 REAL,
    tt20_raw TEXT, tt20_psi REAL, tt20_kg_cm2 REAL,
    t10_raw TEXT, t10_psi REAL, t10_kg_cm2 REAL,
    bct_raw TEXT, bct_psi REAL, bct_kg_cm2 REAL,
    flt_raw TEXT, flt_psi REAL, flt_kg_cm2 REAL,
    raw_a2d TEXT,
    target_value TEXT,
    aw4_pressure_raw TEXT
);

CREATE TABLE IF NOT EXISTS loading_log (
    loading_log_id INTEGER PRIMARY KEY,
    report_id INTEGER NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
    source_row_number INTEGER,
    installed_at TEXT,
    date_raw TEXT,
    time_raw TEXT,
    user_id TEXT,
    filename TEXT,
    software_version TEXT,
    UNIQUE (report_id, source_row_number)
);

CREATE TABLE IF NOT EXISTS stored_fault_log (
    stored_fault_log_id INTEGER PRIMARY KEY,
    report_id INTEGER NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
    source_row_number INTEGER,
    current_status TEXT,
    failure_count INTEGER,
    last_failed_at TEXT,
    last_failed_raw TEXT,
    last_cleared_at TEXT,
    last_cleared_raw TEXT,
    fault_code TEXT,
    description TEXT NOT NULL,
    UNIQUE (report_id, source_row_number)
);

CREATE TABLE IF NOT EXISTS duplicate_rejections (
    duplicate_rejection_id INTEGER PRIMARY KEY,
    import_file_id INTEGER NOT NULL REFERENCES import_files(import_file_id) ON DELETE CASCADE,
    existing_occurrence_id INTEGER REFERENCES event_occurrences(occurrence_id),
    locomotive_number TEXT,
    occurrence_start_at TEXT,
    event_code TEXT,
    event_state TEXT,
    source_line_number INTEGER,
    reason TEXT NOT NULL,
    rejected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS import_errors (
    import_error_id INTEGER PRIMARY KEY,
    import_run_id INTEGER NOT NULL REFERENCES import_runs(import_run_id) ON DELETE CASCADE,
    import_file_id INTEGER REFERENCES import_files(import_file_id) ON DELETE CASCADE,
    source_path TEXT,
    error_type TEXT NOT NULL,
    error_message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_reports_loco_time ON reports(locomotive_id, last_event_at DESC);
CREATE INDEX IF NOT EXISTS ix_occurrences_loco_time ON event_occurrences(locomotive_id, occurrence_start_at DESC);
CREATE INDEX IF NOT EXISTS ix_occurrences_fault ON event_occurrences(event_code_normalized, fault_name);
CREATE INDEX IF NOT EXISTS ix_event_log_time ON event_log(event_timestamp DESC);
CREATE INDEX IF NOT EXISTS ix_import_files_hash ON import_files(file_sha256);

CREATE VIEW IF NOT EXISTS v_event_timeline AS
SELECT o.occurrence_id, l.locomotive_number, o.occurrence_start_at,
       e.event_timestamp, e.event_date, e.event_time, e.event_code,
       e.description, e.state, e.mode, e.source_record_number,
       o.cleared_at, o.duration_seconds, r.source_filename, r.software_version,
       x.mrt_kg_cm2, x.bpt_kg_cm2, x.bpalt_kg_cm2, x.ert_kg_cm2,
       x.tl20_kg_cm2, x.tt20_kg_cm2, x.t10_kg_cm2, x.bct_kg_cm2, x.flt_kg_cm2
FROM event_occurrences o
JOIN locomotives l ON l.locomotive_id = o.locomotive_id
JOIN event_log e ON e.occurrence_id = o.occurrence_id
JOIN reports r ON r.report_id = e.report_id
LEFT JOIN event_environment x ON x.event_log_id = e.event_log_id;

CREATE VIEW IF NOT EXISTS v_fault_locomotive_counts AS
SELECT e.event_code, e.description AS fault_name, l.locomotive_number, COUNT(*) AS occurrence_count
FROM event_log e
JOIN event_occurrences o ON o.occurrence_id = e.occurrence_id
JOIN locomotives l ON l.locomotive_id = o.locomotive_id
WHERE lower(e.state) = 'fail'
GROUP BY e.event_code, e.description, l.locomotive_number;

CREATE VIEW IF NOT EXISTS v_fault_totals AS
SELECT event_code, fault_name, SUM(occurrence_count) AS total_occurrences
FROM v_fault_locomotive_counts
GROUP BY event_code, fault_name
ORDER BY total_occurrences DESC, fault_name;

DROP VIEW IF EXISTS v_locomotive_summary;
CREATE VIEW v_locomotive_summary AS
SELECT l.locomotive_number,
       (SELECT COUNT(*) FROM reports r WHERE r.locomotive_id=l.locomotive_id) AS reports,
       (SELECT COUNT(*) FROM event_occurrences o WHERE o.locomotive_id=l.locomotive_id) AS stored_event_rows,
       (SELECT COUNT(*) FROM event_occurrences o JOIN event_log e ON e.occurrence_id=o.occurrence_id
         WHERE o.locomotive_id=l.locomotive_id AND lower(e.state)='fail') AS fault_occurrences,
       (SELECT MIN(e.event_timestamp) FROM event_occurrences o JOIN event_log e ON e.occurrence_id=o.occurrence_id
         WHERE o.locomotive_id=l.locomotive_id) AS first_event_at,
       (SELECT MAX(e.event_timestamp) FROM event_occurrences o JOIN event_log e ON e.occurrence_id=o.occurrence_id
         WHERE o.locomotive_id=l.locomotive_id) AS latest_event_at
FROM locomotives l;
"""


@dataclass
class ParsedReport:
    locomotive: str
    locomotive_source: str
    software_version: str
    events: list[dict]
    loading: list[dict]
    stored_faults: list[dict]
    malformed: int


def read_text(path: Path) -> tuple[str, bytes]:
    data = path.read_bytes()
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return data.decode(encoding), data
        except UnicodeDecodeError:
            pass
    raise UnicodeDecodeError("unknown", data, 0, 1, "unsupported text encoding")


def split_tab(line: str) -> list[str]:
    values = [value.strip() for value in line.split("\t")]
    while values and not values[-1]:
        values.pop()
    return values


def parse_timestamp(value: str) -> datetime | None:
    match = TIMESTAMP_RE.match((value or "").strip())
    if not match:
        return None
    month, day, year, hour, minute, second = map(int, match.groups())
    try:
        return datetime(year, month, day, hour, minute, second)
    except ValueError:
        return None


def iso(value: datetime | None) -> str | None:
    return value.strftime("%Y-%m-%d %H:%M:%S") if value else None


def normalize_code(value: str) -> str:
    text = str(value or "").strip()
    return str(int(text)) if text.isdigit() else text.upper()


def pressure(raw: str) -> tuple[str, float | None, float | None]:
    text = str(raw or "").strip()
    if not text or re.match(r"^(?:N/?A|NOT\s*AVAILABLE)$", text, re.I):
        return text, None, None
    try:
        psi = float(text) / 10.0
    except ValueError:
        return text, None, None
    return text, psi, psi * PSI_TO_KG_CM2


def parse_loading(lines: list[str]) -> list[dict]:
    start = next((i for i, line in enumerate(lines) if re.match(r"^\s*Loading Log\s*$", line, re.I)), -1)
    if start < 0:
        return []
    end = next((i for i in range(start + 1, len(lines)) if re.match(r"^\s*Run Time Data\s*$", lines[i], re.I)), len(lines))
    rows = []
    pattern = re.compile(r"^(\d+)\s+(\d{1,2}/\d{1,2}/\d{2,4})\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM))\s+(\S+)\s+(.+)$", re.I)
    for offset, source in enumerate(lines[start + 1:end]):
        line = source.strip()
        if not line or re.match(r"^=+$", line) or re.match(r"^Num\b", line, re.I):
            continue
        parts = [x.strip() for x in source.split("\t") if x.strip()]
        if len(parts) >= 5 and parts[0].isdigit():
            number, date_raw, time_raw, user_id = parts[:4]
            filename = " ".join(parts[4:])
        else:
            match = pattern.match(line)
            if not match:
                continue
            number, date_raw, time_raw, user_id, filename = match.groups()
        installed = None
        try:
            date_bits = date_raw.split("/")
            year = int(date_bits[2])
            if len(date_bits[2]) == 2:
                year += 1900 if year >= 70 else 2000
            installed = datetime.strptime(f"{date_bits[0]}/{date_bits[1]}/{year} {re.sub(r'\s+', ' ', time_raw).upper()}", "%m/%d/%Y %I:%M:%S %p")
        except ValueError:
            try:
                installed = datetime.strptime(f"{date_bits[0]}/{date_bits[1]}/{year} {re.sub(r'\s+', ' ', time_raw).upper()}", "%m/%d/%Y %I:%M %p")
            except (ValueError, UnboundLocalError):
                pass
        version_match = re.match(r"^(.+?)_RCPH", filename, re.I)
        rows.append({"row": offset, "number": int(number), "date": date_raw, "time": re.sub(r"\s+", " ", time_raw).upper(),
                     "user": user_id, "filename": filename, "version": version_match.group(1) if version_match else re.sub(r"\.[^.]+$", "", filename), "installed": installed})
    return rows


def parse_stored_faults(lines: list[str]) -> list[dict]:
    start = next((i for i, line in enumerate(lines) if re.match(r"^\s*Fault Log Data\s*$", line, re.I)), -1)
    if start < 0:
        return []
    end = next((i for i in range(start + 1, len(lines)) if re.match(r"^\s*Event Log Data\s*$", lines[i], re.I)), len(lines))
    rows = []
    for offset, source in enumerate(lines[start + 1:end]):
        parts = split_tab(source)
        if len(parts) < 5 or not parts[1].isdigit():
            continue
        description = " ".join(parts[4:]).strip()
        if not description:
            continue
        match = re.search(r"F/C\s*\[(\d+)\]", description, re.I)
        rows.append({"row": offset, "status": parts[0] or "Not reported", "count": int(parts[1]),
                     "failed_raw": parts[2], "failed": parse_timestamp(parts[2]), "cleared_raw": parts[3],
                     "cleared": parse_timestamp(parts[3]), "code": match.group(1) if match else "", "description": description})
    return rows


def parse_report(text: str, filename: str, parent_locomotive: str) -> ParsedReport:
    lines = text.lstrip("\ufeff").splitlines()
    section = next((i for i, line in enumerate(lines) if re.match(r"^\s*Event Log Data\s*$", line, re.I)), -1)
    if section < 0:
        raise ValueError('The file does not contain an "Event Log Data" section.')
    header = next((i for i in range(section + 1, len(lines)) if re.search(r"Time Stamp", lines[i], re.I) and re.search(r"Description", lines[i], re.I)), -1)
    if header < 0:
        raise ValueError("The Event Log column header could not be found.")
    software = next((line.strip() for line in lines[:section] if line.strip()), "Unknown")
    report_loco = None
    for line in lines:
        if re.match(r"^\s*(?:Locomotive|Loco)\s*(?:Number|No\.?|#)\s*:", line, re.I):
            match = re.search(r":\s*([A-Z0-9/-]+)", line, re.I)
            if match and not re.match(r"^(?:N/?A|NA|NONE|UNKNOWN)$", match.group(1), re.I):
                report_loco = match.group(1)
                break
    file_match = re.match(r"^\s*([A-Z0-9-]{4,12})\b", filename, re.I)
    if report_loco:
        locomotive, loco_source = report_loco, "report"
    elif file_match:
        locomotive, loco_source = file_match.group(1), "filename"
    elif re.fullmatch(r"\d{4,12}", parent_locomotive or ""):
        locomotive, loco_source = parent_locomotive, "folder"
    else:
        raise ValueError("Locomotive number could not be identified from report, filename, or folder.")

    events, malformed = [], 0
    for line_index in range(header + 1, len(lines)):
        parts = split_tab(lines[line_index])
        if not parts or not re.fullmatch(r"\d{1,3}", parts[0]):
            continue
        if len(parts) < 18:
            malformed += 1
            continue
        stamp = parse_timestamp(parts[15])
        if not stamp:
            malformed += 1
            continue
        raw_values = dict(zip(PRESSURE_FIELDS, parts[1:10]))
        events.append({"record": parts[0].zfill(3), "raw": raw_values, "raw_a2d": parts[10], "target": parts[11], "aw4": parts[12],
                       "mode": parts[13], "state": parts[14], "state_norm": parts[14].lower(), "timestamp_raw": parts[15],
                       "timestamp": stamp, "code": parts[16], "code_norm": normalize_code(parts[16]),
                       "description": " ".join(parts[17:]).strip(), "line": line_index + 1})
    if not events:
        raise ValueError("No valid Event Log rows were found below the header.")
    events.sort(key=lambda row: (row["timestamp"], row["line"]))

    waiting: dict[tuple[str, str], deque] = defaultdict(deque)
    for event in events:
        event["occurrence"] = event["timestamp"]
        event["cleared"] = None
        event["duration"] = None
        event["resolution"] = None
        key = (event["code_norm"], event["description"].lower())
        if event["state_norm"] == "fail":
            waiting[key].append(event)
            event["resolution"] = "Unresolved"
        elif event["state_norm"] == "pass" and waiting[key]:
            failed = waiting[key].popleft()
            event["occurrence"] = failed["timestamp"]
            failed["cleared"] = event["timestamp"]
            failed["duration"] = max(0, int((event["timestamp"] - failed["timestamp"]).total_seconds()))
            failed["resolution"] = "Cleared"
            event["resolution"] = "Clear row"
    return ParsedReport(locomotive, loco_source, software, events, parse_loading(lines), parse_stored_faults(lines), malformed)


def create_database(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = NORMAL")
    connection.executescript(SCHEMA)
    return connection


def insert_report(connection: sqlite3.Connection, run_id: int, source_root: Path, path: Path) -> dict:
    text, raw_bytes = read_text(path)
    digest = hashlib.sha256(raw_bytes).hexdigest()
    try:
        relative = str(path.relative_to(source_root))
    except ValueError:
        relative = str(Path("__additional_files__") / path.name)
    parent_loco = path.parent.name
    import_file_id = connection.execute(
        "INSERT INTO import_files(import_run_id,source_path,source_relative_path,source_filename,file_sha256,file_size_bytes,status) VALUES(?,?,?,?,?,?,'parsing')",
        (run_id, str(path), relative, path.name, digest, len(raw_bytes)),
    ).lastrowid
    try:
        parsed = parse_report(text, path.name, parent_loco)
    except Exception as exc:
        connection.execute("UPDATE import_files SET status='invalid', message=? WHERE import_file_id=?", (str(exc), import_file_id))
        connection.execute("INSERT INTO import_errors(import_run_id,import_file_id,source_path,error_type,error_message) VALUES(?,?,?,?,?)",
                           (run_id, import_file_id, str(path), type(exc).__name__, str(exc)))
        return {"status": "invalid", "read": 0, "inserted": 0, "duplicates": 0}

    connection.execute("UPDATE import_files SET locomotive_number_detected=?, locomotive_source=?, parsed_event_rows=?, malformed_event_rows=? WHERE import_file_id=?",
                       (parsed.locomotive, parsed.locomotive_source, len(parsed.events), parsed.malformed, import_file_id))
    locomotive_id = connection.execute("INSERT INTO locomotives(locomotive_number,last_imported_at) VALUES(?,CURRENT_TIMESTAMP) ON CONFLICT(locomotive_number) DO UPDATE SET last_imported_at=CURRENT_TIMESTAMP RETURNING locomotive_id", (parsed.locomotive,)).fetchone()[0]
    existing = connection.execute("SELECT report_id FROM reports WHERE locomotive_id=? AND file_sha256=?", (locomotive_id, digest)).fetchone()
    if existing:
        connection.execute("UPDATE import_files SET report_id=?, status='duplicate_file', duplicate_event_rows=?, message='Exact file content already imported for this locomotive.' WHERE import_file_id=?",
                           (existing[0], len(parsed.events), import_file_id))
        connection.execute("INSERT INTO duplicate_rejections(import_file_id,locomotive_number,reason) VALUES(?,?,'Exact file content already imported')", (import_file_id, parsed.locomotive))
        return {"status": "duplicate", "read": len(parsed.events), "inserted": 0, "duplicates": len(parsed.events)}

    report_id = connection.execute(
        "INSERT INTO reports(locomotive_id,source_filename,source_path,file_sha256,software_version,first_event_at,last_event_at,parsed_event_count,malformed_event_count) VALUES(?,?,?,?,?,?,?,?,?)",
        (locomotive_id, path.name, str(path), digest, parsed.software_version, iso(parsed.events[0]["timestamp"]), iso(parsed.events[-1]["timestamp"]), len(parsed.events), parsed.malformed),
    ).lastrowid
    connection.execute("UPDATE import_files SET report_id=? WHERE import_file_id=?", (report_id, import_file_id))
    inserted = duplicates = 0
    for event in parsed.events:
        key_values = (locomotive_id, iso(event["occurrence"]), event["code_norm"], event["state_norm"])
        try:
            occurrence_id = connection.execute(
                "INSERT INTO event_occurrences(locomotive_id,occurrence_start_at,event_code_normalized,event_state_normalized,event_timestamp,event_code,fault_name,cleared_at,duration_seconds,resolution_status,first_report_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (*key_values, iso(event["timestamp"]), event["code"], event["description"], iso(event["cleared"]), event["duration"], event["resolution"], report_id),
            ).lastrowid
        except sqlite3.IntegrityError:
            duplicates += 1
            existing_id = connection.execute("SELECT occurrence_id FROM event_occurrences WHERE locomotive_id=? AND occurrence_start_at=? AND event_code_normalized=? AND event_state_normalized=?", key_values).fetchone()[0]
            connection.execute("INSERT INTO duplicate_rejections(import_file_id,existing_occurrence_id,locomotive_number,occurrence_start_at,event_code,event_state,source_line_number,reason) VALUES(?,?,?,?,?,?,?,'Duplicate locomotive + occurrence start second + event code + state')",
                               (import_file_id, existing_id, parsed.locomotive, key_values[1], event["code"], event["state"], event["line"]))
            continue
        event_log_id = connection.execute(
            "INSERT INTO event_log(occurrence_id,report_id,source_record_number,source_line_number,event_timestamp,event_date,event_time,event_code,description,state,mode,timestamp_raw) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (occurrence_id, report_id, event["record"], event["line"], iso(event["timestamp"]), event["timestamp"].strftime("%Y-%m-%d"), event["timestamp"].strftime("%H:%M:%S"), event["code"], event["description"], event["state"], event["mode"], event["timestamp_raw"]),
        ).lastrowid
        scaled = []
        for field in PRESSURE_FIELDS:
            scaled.extend(pressure(event["raw"][field]))
        placeholders = ",".join("?" for _ in range(31))
        connection.execute(f"INSERT INTO event_environment VALUES({placeholders})", (event_log_id, *scaled, event["raw_a2d"], event["target"], event["aw4"]))
        inserted += 1

    for row in parsed.loading:
        connection.execute("INSERT INTO loading_log(report_id,source_row_number,installed_at,date_raw,time_raw,user_id,filename,software_version) VALUES(?,?,?,?,?,?,?,?)",
                           (report_id, row["row"], iso(row["installed"]), row["date"], row["time"], row["user"], row["filename"], row["version"]))
    for row in parsed.stored_faults:
        connection.execute("INSERT INTO stored_fault_log(report_id,source_row_number,current_status,failure_count,last_failed_at,last_failed_raw,last_cleared_at,last_cleared_raw,fault_code,description) VALUES(?,?,?,?,?,?,?,?,?,?)",
                           (report_id, row["row"], row["status"], row["count"], iso(row["failed"]), row["failed_raw"], iso(row["cleared"]), row["cleared_raw"], row["code"], row["description"]))
    status = "imported" if inserted else "duplicate_overlap"
    message = None if inserted else "All Event Log rows already existed; ancillary logs retained with this report."
    connection.execute("UPDATE reports SET stored_event_count=?, duplicate_event_count=? WHERE report_id=?", (inserted, duplicates, report_id))
    connection.execute("UPDATE import_files SET status=?, inserted_event_rows=?, duplicate_event_rows=?, message=? WHERE import_file_id=?",
                       (status, inserted, duplicates, message, import_file_id))
    return {"status": status, "read": len(parsed.events), "inserted": inserted, "duplicates": duplicates}


def import_folder(source_root: Path, db_path: Path, rebuild: bool = False, additional_files: list[Path] | None = None) -> dict:
    source_root, db_path = source_root.resolve(), db_path.resolve()
    if rebuild and db_path.exists():
        db_path.unlink()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    files = sorted((p for p in source_root.rglob("*") if p.is_file() and p.suffix.lower() == ".txt"), key=lambda p: str(p).lower())
    for extra in additional_files or []:
        extra = extra.resolve()
        if extra.is_file() and extra.suffix.lower() == ".txt" and extra not in files:
            files.append(extra)
    connection = create_database(db_path)
    run_id = connection.execute("INSERT INTO import_runs(source_root,txt_files_found) VALUES(?,?)", (str(source_root), len(files))).lastrowid
    connection.commit()
    totals = {"txt_files_found": len(files), "files_imported": 0, "files_duplicate": 0, "files_invalid": 0,
              "event_rows_read": 0, "event_rows_inserted": 0, "event_rows_duplicate": 0}
    for index, path in enumerate(files, 1):
        try:
            connection.execute("SAVEPOINT one_file")
            outcome = insert_report(connection, run_id, source_root, path)
            connection.execute("RELEASE one_file")
            connection.commit()
        except Exception as exc:
            connection.execute("ROLLBACK TO one_file")
            connection.execute("RELEASE one_file")
            connection.execute("INSERT INTO import_errors(import_run_id,source_path,error_type,error_message) VALUES(?,?,?,?)", (run_id, str(path), type(exc).__name__, str(exc)))
            connection.commit()
            outcome = {"status": "invalid", "read": 0, "inserted": 0, "duplicates": 0}
        totals["event_rows_read"] += outcome["read"]
        totals["event_rows_inserted"] += outcome["inserted"]
        totals["event_rows_duplicate"] += outcome["duplicates"]
        if outcome["status"] == "invalid":
            totals["files_invalid"] += 1
        elif outcome["status"] in ("duplicate", "duplicate_overlap"):
            totals["files_duplicate"] += 1
        else:
            totals["files_imported"] += 1
        print(f"[{index:03}/{len(files):03}] {outcome['status']:<17} {path.name}: +{outcome['inserted']} / dup {outcome['duplicates']}")
    connection.execute("UPDATE import_runs SET finished_at=CURRENT_TIMESTAMP,status='completed',files_imported=?,files_duplicate=?,files_invalid=?,event_rows_read=?,event_rows_inserted=?,event_rows_duplicate=? WHERE import_run_id=?",
                       (totals["files_imported"], totals["files_duplicate"], totals["files_invalid"], totals["event_rows_read"], totals["event_rows_inserted"], totals["event_rows_duplicate"], run_id))
    connection.commit()
    totals["database"] = str(db_path)
    totals["database_size_bytes"] = db_path.stat().st_size
    totals["table_rows"] = {name: connection.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0] for name in
                            ("locomotives", "import_runs", "import_files", "reports", "event_occurrences", "event_log", "event_environment", "loading_log", "stored_fault_log", "duplicate_rejections", "import_errors")}
    connection.close()
    return totals


def main() -> int:
    workspace = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="Import CCB TXT reports into SQLite")
    parser.add_argument("--source", type=Path, default=Path.home() / "Desktop" / "CCB LOCO DATA")
    parser.add_argument("--database", type=Path, default=workspace / "ccb_fleet.sqlite")
    parser.add_argument("--additional-file", type=Path, action="append", default=[], help="Also import a TXT outside the source folder (repeatable)")
    parser.add_argument("--rebuild", action="store_true", help="Delete only the selected SQLite file and rebuild it")
    args = parser.parse_args()
    if not args.source.is_dir():
        parser.error(f"source folder does not exist: {args.source}")
    missing = [str(path) for path in args.additional_file if not path.is_file()]
    if missing:
        parser.error("additional TXT does not exist: " + ", ".join(missing))
    totals = import_folder(args.source, args.database, args.rebuild, args.additional_file)
    print("\nFINAL CENSUS")
    print(json.dumps(totals, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
