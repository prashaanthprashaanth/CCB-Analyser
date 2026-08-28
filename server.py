#!/usr/bin/env python3
"""LAN web server and shared SQLite API for CCB Fault Analyser."""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import signal
import sqlite3
import sys
import threading
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlsplit

from DATABASE_FOR_APPROVAL.import_ccb_to_sqlite import (
    PRESSURE_FIELDS,
    SCHEMA,
    iso,
    normalize_code,
    parse_report,
    pressure,
    read_text,
)


APP_ROOT = Path(__file__).resolve().parent
DEFAULT_DATABASE = APP_ROOT / "ccb_fleet.sqlite"
STATIC_FILES = {
    "/": "index.html",
    "/index.html": "index.html",
    "/styles.css": "styles.css",
    "/parser.js": "parser.js",
    "/database.js": "database.js",
    "/app.js": "app.js",
}
MAX_REQUEST_BYTES = 128 * 1024 * 1024
MAX_REPORTS_PER_REQUEST = 2_000
WRITE_LOCK = threading.Lock()


def json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def milliseconds(value: str | None) -> int | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return int(parsed.timestamp() * 1000)


def connect_database(database_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(database_path, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = NORMAL")
    connection.execute("PRAGMA busy_timeout = 30000")
    return connection


def migrate_database(database_path: Path) -> None:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = connect_database(database_path)
    try:
        connection.executescript(SCHEMA)
        report_columns = {row["name"] for row in connection.execute("PRAGMA table_info(reports)")}
        if "raw_text" not in report_columns:
            connection.execute("ALTER TABLE reports ADD COLUMN raw_text TEXT")
        if "locomotive_source" not in report_columns:
            connection.execute("ALTER TABLE reports ADD COLUMN locomotive_source TEXT")
        missing_raw_reports = connection.execute(
            "SELECT report_id,source_path FROM reports WHERE raw_text IS NULL OR raw_text=''"
        ).fetchall()
        for row in missing_raw_reports:
            source_path = Path(row["source_path"])
            if source_path.is_file():
                raw_text, _ = read_text(source_path)
                connection.execute("UPDATE reports SET raw_text=? WHERE report_id=?", (raw_text, row["report_id"]))
        connection.execute(
            """UPDATE reports SET locomotive_source=(
                   SELECT f.locomotive_source FROM import_files f
                   WHERE f.report_id=reports.report_id AND f.locomotive_source IS NOT NULL
                   ORDER BY f.import_file_id LIMIT 1
               )
               WHERE locomotive_source IS NULL"""
        )
        connection.execute("CREATE INDEX IF NOT EXISTS ix_reports_locomotive ON reports(locomotive_id)")
        connection.execute("CREATE INDEX IF NOT EXISTS ix_event_log_report ON event_log(report_id)")
        connection.execute("CREATE INDEX IF NOT EXISTS ix_event_log_state ON event_log(state)")
        connection.commit()
    finally:
        connection.close()


def pressure_payload(row: sqlite3.Row, prefix: str) -> dict:
    raw = row[f"{prefix}_raw"]
    psi = row[f"{prefix}_psi"]
    kg_cm2 = row[f"{prefix}_kg_cm2"]
    return {
        "raw": "" if raw is None else str(raw),
        "psi": psi,
        "kgCm2": kg_cm2,
        "display": "Not Available" if kg_cm2 is None else f"{kg_cm2:.2f}",
    }


def event_payload(row: sqlite3.Row) -> dict:
    timestamp_ms = milliseconds(row["event_timestamp"])
    cleared_ms = milliseconds(row["cleared_at"])
    values = {
        "mrt": pressure_payload(row, "mrt"),
        "bpt": pressure_payload(row, "bpt"),
        "bpAlt": pressure_payload(row, "bpalt"),
        "ert": pressure_payload(row, "ert"),
        "twentyTl": pressure_payload(row, "tl20"),
        "twentyTt": pressure_payload(row, "tt20"),
        "tenT": pressure_payload(row, "t10"),
        "bct": pressure_payload(row, "bct"),
        "flt": pressure_payload(row, "flt"),
    }
    return {
        "locomotiveNumber": row["locomotive_number"],
        "reportKey": str(row["report_id"]),
        "softwareVersion": row["software_version"] or "Unknown",
        "sourceFile": row["source_filename"],
        "record": row["source_record_number"] or "",
        "originalIndex": row["source_line_number"] or row["event_log_id"],
        "timestampMs": timestamp_ms,
        "timestampRaw": row["timestamp_raw"] or "",
        "dateKey": row["event_date"],
        "eventCode": row["event_code"],
        "eventIdentity": normalize_code(row["event_code"]),
        "description": row["description"],
        "state": row["state"],
        "stateLower": str(row["state"] or "").lower(),
        "mode": row["mode"] or "",
        "occurrenceTimestampMs": milliseconds(row["occurrence_start_at"]),
        "clearedAtMs": cleared_ms,
        "durationMs": None if row["duration_seconds"] is None else row["duration_seconds"] * 1000,
        "mrt": values["mrt"]["raw"],
        "bpt": values["bpt"]["raw"],
        "bpAlt": values["bpAlt"]["raw"],
        "ert": values["ert"]["raw"],
        "twentyTl": values["twentyTl"]["raw"],
        "twentyTt": values["twentyTt"]["raw"],
        "tenT": values["tenT"]["raw"],
        "bct": values["bct"]["raw"],
        "flt": values["flt"]["raw"],
        "pressureValues": values,
    }


EVENT_SELECT = """
SELECT e.event_log_id, e.report_id, e.source_record_number, e.source_line_number,
       e.event_timestamp, e.event_date, e.event_time, e.event_code, e.description,
       e.state, e.mode, e.timestamp_raw,
       o.occurrence_start_at, o.cleared_at, o.duration_seconds,
       l.locomotive_number, r.source_filename, r.software_version,
       x.mrt_raw, x.mrt_psi, x.mrt_kg_cm2,
       x.bpt_raw, x.bpt_psi, x.bpt_kg_cm2,
       x.bpalt_raw, x.bpalt_psi, x.bpalt_kg_cm2,
       x.ert_raw, x.ert_psi, x.ert_kg_cm2,
       x.tl20_raw, x.tl20_psi, x.tl20_kg_cm2,
       x.tt20_raw, x.tt20_psi, x.tt20_kg_cm2,
       x.t10_raw, x.t10_psi, x.t10_kg_cm2,
       x.bct_raw, x.bct_psi, x.bct_kg_cm2,
       x.flt_raw, x.flt_psi, x.flt_kg_cm2
FROM event_log e
JOIN event_occurrences o ON o.occurrence_id = e.occurrence_id
JOIN locomotives l ON l.locomotive_id = o.locomotive_id
JOIN reports r ON r.report_id = e.report_id
LEFT JOIN event_environment x ON x.event_log_id = e.event_log_id
"""


def get_locomotives(connection: sqlite3.Connection) -> list[dict]:
    rows = connection.execute(
        """
        SELECT l.locomotive_number,
               COUNT(DISTINCT r.report_id) AS report_count,
               COUNT(e.event_log_id) AS event_count,
               SUM(CASE WHEN lower(e.state)='fail' THEN 1 ELSE 0 END) AS fault_count,
               SUM(CASE WHEN lower(e.state)='fail' AND o.cleared_at IS NOT NULL THEN 1 ELSE 0 END) AS cleared_count,
               MIN(e.event_timestamp) AS first_event_at,
               MAX(e.event_timestamp) AS last_event_at,
               MAX(r.imported_at) AS last_imported_at,
               GROUP_CONCAT(DISTINCT r.software_version) AS software_versions
        FROM locomotives l
        LEFT JOIN reports r ON r.locomotive_id = l.locomotive_id
        LEFT JOIN event_log e ON e.report_id = r.report_id
        LEFT JOIN event_occurrences o ON o.occurrence_id = e.occurrence_id
        GROUP BY l.locomotive_id, l.locomotive_number
        ORDER BY length(l.locomotive_number), l.locomotive_number
        """
    ).fetchall()
    result = []
    for row in rows:
        versions = sorted(
            (value for value in str(row["software_versions"] or "").split(",") if value),
            key=str.casefold,
        )
        result.append({
            "locomotiveNumber": row["locomotive_number"],
            "reportCount": row["report_count"] or 0,
            "eventCount": row["event_count"] or 0,
            "faultCount": row["fault_count"] or 0,
            "clearedCount": row["cleared_count"] or 0,
            "firstTimestampMs": milliseconds(row["first_event_at"]),
            "lastTimestampMs": milliseconds(row["last_event_at"]),
            "lastImportedAt": row["last_imported_at"],
            "softwareVersions": versions,
        })
    return result


def get_summary(connection: sqlite3.Connection) -> dict:
    row = connection.execute(
        """
        SELECT (SELECT COUNT(*) FROM locomotives) AS locomotive_count,
               (SELECT COUNT(*) FROM reports) AS report_count,
               COUNT(e.event_log_id) AS event_count,
               SUM(CASE WHEN lower(e.state)='fail' THEN 1 ELSE 0 END) AS fault_count,
               SUM(CASE WHEN lower(e.state)='fail' AND o.cleared_at IS NOT NULL THEN 1 ELSE 0 END) AS cleared_count,
               MIN(e.event_timestamp) AS first_event_at,
               MAX(e.event_timestamp) AS last_event_at
        FROM event_log e
        LEFT JOIN event_occurrences o ON o.occurrence_id=e.occurrence_id
        """
    ).fetchone()
    return {
        "locomotiveCount": row["locomotive_count"] or 0,
        "reportCount": row["report_count"] or 0,
        "eventCount": row["event_count"] or 0,
        "faultCount": row["fault_count"] or 0,
        "clearedCount": row["cleared_count"] or 0,
        "firstTimestampMs": milliseconds(row["first_event_at"]),
        "lastTimestampMs": milliseconds(row["last_event_at"]),
    }


def get_reports(connection: sqlite3.Connection, locomotive_number: str) -> list[dict]:
    rows = connection.execute(
        """
        SELECT r.* FROM reports r
        JOIN locomotives l ON l.locomotive_id=r.locomotive_id
        WHERE l.locomotive_number=?
        ORDER BY r.first_event_at, r.source_filename
        """,
        (locomotive_number,),
    ).fetchall()
    return [{
        "reportKey": str(row["report_id"]),
        "locomotiveNumber": locomotive_number,
        "fileName": row["source_filename"],
        "softwareVersion": row["software_version"] or "Unknown",
        "importedAt": row["imported_at"],
        "sourceEventCount": row["parsed_event_count"],
        "eventCount": row["stored_event_count"],
        "skippedDuplicateEventCount": row["duplicate_event_count"],
        "malformedRows": row["malformed_event_count"],
        "firstTimestampMs": milliseconds(row["first_event_at"]),
        "lastTimestampMs": milliseconds(row["last_event_at"]),
    } for row in rows]


def get_events(connection: sqlite3.Connection, locomotive_number: str, direction: str) -> list[dict]:
    order = "ASC" if direction.lower() == "asc" else "DESC"
    rows = connection.execute(
        EVENT_SELECT + f" WHERE l.locomotive_number=? ORDER BY e.event_timestamp {order}, e.event_log_id {order}",
        (locomotive_number,),
    ).fetchall()
    return [event_payload(row) for row in rows]


def get_fault_matrix(connection: sqlite3.Connection) -> dict:
    locomotives = [row[0] for row in connection.execute(
        "SELECT locomotive_number FROM locomotives ORDER BY length(locomotive_number), locomotive_number"
    )]
    rows = connection.execute(
        """
        SELECT e.event_code, e.description, l.locomotive_number, COUNT(*) AS occurrence_count
        FROM event_log e
        JOIN event_occurrences o ON o.occurrence_id=e.occurrence_id
        JOIN locomotives l ON l.locomotive_id=o.locomotive_id
        WHERE lower(e.state)='fail'
        GROUP BY upper(trim(e.event_code)), lower(trim(e.description)), l.locomotive_number
        ORDER BY e.description, e.event_code, l.locomotive_number
        """
    ).fetchall()
    grouped: dict[tuple[str, str], dict] = {}
    for row in rows:
        key = (str(row["event_code"] or "").strip().upper(), str(row["description"] or "").strip().lower())
        item = grouped.setdefault(key, {
            "eventCode": str(row["event_code"] or ""),
            "faultName": row["description"] or "Unknown fault",
            "description": row["description"] or "Unknown fault",
            "counts": {},
            "total": 0,
        })
        item["counts"][row["locomotive_number"]] = row["occurrence_count"]
        item["total"] += row["occurrence_count"]
    matrix_rows = sorted(grouped.values(), key=lambda item: (-item["total"], item["faultName"], item["eventCode"]))
    return {"locomotives": locomotives, "rows": matrix_rows}


def insert_web_report(
    connection: sqlite3.Connection,
    run_id: int,
    entry: dict,
    client_ip: str,
) -> dict:
    raw_text = str(entry.get("rawText") or "")
    file_name = Path(str(entry.get("fileName") or "CCB report.txt")).name
    hinted_locomotive = str(entry.get("locomotiveNumber") or "")
    digest = hashlib.sha256(raw_text.encode("utf-8")).hexdigest()
    source_path = f"web://{client_ip}/{quote(file_name)}"
    import_file_id = connection.execute(
        """INSERT INTO import_files(
               import_run_id,source_path,source_relative_path,source_filename,file_sha256,file_size_bytes,status
           ) VALUES(?,?,?,?,?,?,'parsing')""",
        (run_id, source_path, file_name, file_name, digest, len(raw_text.encode("utf-8"))),
    ).lastrowid

    try:
        parser_file_name = f"{hinted_locomotive}_{file_name}" if hinted_locomotive else file_name
        parsed = parse_report(raw_text, parser_file_name, hinted_locomotive)
        if hinted_locomotive and parsed.locomotive == hinted_locomotive and entry.get("locomotiveNumberSource"):
            parsed.locomotive_source = str(entry["locomotiveNumberSource"])
    except Exception as error:
        connection.execute(
            "UPDATE import_files SET status='invalid',message=? WHERE import_file_id=?",
            (str(error), import_file_id),
        )
        connection.execute(
            """INSERT INTO import_errors(import_run_id,import_file_id,source_path,error_type,error_message)
               VALUES(?,?,?,?,?)""",
            (run_id, import_file_id, source_path, type(error).__name__, str(error)),
        )
        return {
            "status": "invalid",
            "reportKey": None,
            "fileName": file_name,
            "storedEventCount": 0,
            "skippedDuplicateEventCount": 0,
            "message": str(error),
        }

    connection.execute(
        """UPDATE import_files SET locomotive_number_detected=?,locomotive_source=?,
               parsed_event_rows=?,malformed_event_rows=? WHERE import_file_id=?""",
        (parsed.locomotive, parsed.locomotive_source, len(parsed.events), parsed.malformed, import_file_id),
    )
    locomotive_id = connection.execute(
        """INSERT INTO locomotives(locomotive_number,last_imported_at)
           VALUES(?,CURRENT_TIMESTAMP)
           ON CONFLICT(locomotive_number) DO UPDATE SET last_imported_at=CURRENT_TIMESTAMP
           RETURNING locomotive_id""",
        (parsed.locomotive,),
    ).fetchone()[0]
    existing = connection.execute(
        "SELECT report_id FROM reports WHERE locomotive_id=? AND file_sha256=?",
        (locomotive_id, digest),
    ).fetchone()
    if existing:
        connection.execute(
            """UPDATE import_files SET report_id=?,status='duplicate_file',duplicate_event_rows=?,
                   message='Exact file content already imported for this locomotive.' WHERE import_file_id=?""",
            (existing[0], len(parsed.events), import_file_id),
        )
        connection.execute(
            """INSERT INTO duplicate_rejections(import_file_id,locomotive_number,reason)
               VALUES(?,?,'Exact file content already imported')""",
            (import_file_id, parsed.locomotive),
        )
        return {
            "status": "duplicate",
            "reportKey": str(existing[0]),
            "fileName": file_name,
            "storedEventCount": 0,
            "skippedDuplicateEventCount": len(parsed.events),
        }

    report_id = connection.execute(
        """INSERT INTO reports(
               locomotive_id,source_filename,source_path,file_sha256,software_version,
               first_event_at,last_event_at,parsed_event_count,malformed_event_count,raw_text,locomotive_source
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
        (
            locomotive_id, file_name, source_path, digest, parsed.software_version,
            iso(parsed.events[0]["timestamp"]), iso(parsed.events[-1]["timestamp"]),
            len(parsed.events), parsed.malformed, raw_text, parsed.locomotive_source,
        ),
    ).lastrowid
    connection.execute("UPDATE import_files SET report_id=? WHERE import_file_id=?", (report_id, import_file_id))
    inserted = 0
    duplicates = 0
    for event in parsed.events:
        key_values = (
            locomotive_id,
            iso(event["occurrence"]),
            event["code_norm"],
            event["state_norm"],
        )
        try:
            occurrence_id = connection.execute(
                """INSERT INTO event_occurrences(
                       locomotive_id,occurrence_start_at,event_code_normalized,event_state_normalized,
                       event_timestamp,event_code,fault_name,cleared_at,duration_seconds,
                       resolution_status,first_report_id
                   ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    *key_values, iso(event["timestamp"]), event["code"], event["description"],
                    iso(event["cleared"]), event["duration"], event["resolution"], report_id,
                ),
            ).lastrowid
        except sqlite3.IntegrityError:
            duplicates += 1
            existing_id = connection.execute(
                """SELECT occurrence_id FROM event_occurrences
                   WHERE locomotive_id=? AND occurrence_start_at=?
                     AND event_code_normalized=? AND event_state_normalized=?""",
                key_values,
            ).fetchone()[0]
            connection.execute(
                """INSERT INTO duplicate_rejections(
                       import_file_id,existing_occurrence_id,locomotive_number,occurrence_start_at,
                       event_code,event_state,source_line_number,reason
                   ) VALUES(?,?,?,?,?,?,?,'Duplicate locomotive + occurrence start second + event code + state')""",
                (
                    import_file_id, existing_id, parsed.locomotive, key_values[1],
                    event["code"], event["state"], event["line"],
                ),
            )
            continue

        event_log_id = connection.execute(
            """INSERT INTO event_log(
                   occurrence_id,report_id,source_record_number,source_line_number,event_timestamp,
                   event_date,event_time,event_code,description,state,mode,timestamp_raw
               ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                occurrence_id, report_id, event["record"], event["line"], iso(event["timestamp"]),
                event["timestamp"].strftime("%Y-%m-%d"), event["timestamp"].strftime("%H:%M:%S"),
                event["code"], event["description"], event["state"], event["mode"], event["timestamp_raw"],
            ),
        ).lastrowid
        scaled = []
        for field in PRESSURE_FIELDS:
            scaled.extend(pressure(event["raw"][field]))
        placeholders = ",".join("?" for _ in range(31))
        connection.execute(
            f"INSERT INTO event_environment VALUES({placeholders})",
            (event_log_id, *scaled, event["raw_a2d"], event["target"], event["aw4"]),
        )
        inserted += 1

    if not inserted:
        connection.execute("DELETE FROM reports WHERE report_id=?", (report_id,))
        connection.execute(
            """UPDATE import_files SET report_id=NULL,status='duplicate_overlap',inserted_event_rows=0,
                   duplicate_event_rows=?,message='All Event Log rows already existed; report not stored.'
               WHERE import_file_id=?""",
            (duplicates, import_file_id),
        )
        return {
            "status": "duplicate_overlap",
            "reportKey": None,
            "fileName": file_name,
            "storedEventCount": 0,
            "skippedDuplicateEventCount": duplicates,
        }

    for item in parsed.loading:
        connection.execute(
            """INSERT INTO loading_log(
                   report_id,source_row_number,installed_at,date_raw,time_raw,user_id,filename,software_version
               ) VALUES(?,?,?,?,?,?,?,?)""",
            (
                report_id, item["row"], iso(item["installed"]), item["date"], item["time"],
                item["user"], item["filename"], item["version"],
            ),
        )
    for item in parsed.stored_faults:
        connection.execute(
            """INSERT INTO stored_fault_log(
                   report_id,source_row_number,current_status,failure_count,last_failed_at,last_failed_raw,
                   last_cleared_at,last_cleared_raw,fault_code,description
               ) VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (
                report_id, item["row"], item["status"], item["count"], iso(item["failed"]),
                item["failed_raw"], iso(item["cleared"]), item["cleared_raw"],
                item["code"], item["description"],
            ),
        )
    connection.execute(
        "UPDATE reports SET stored_event_count=?,duplicate_event_count=? WHERE report_id=?",
        (inserted, duplicates, report_id),
    )
    connection.execute(
        """UPDATE import_files SET status='imported',inserted_event_rows=?,duplicate_event_rows=?
           WHERE import_file_id=?""",
        (inserted, duplicates, import_file_id),
    )
    return {
        "status": "saved",
        "reportKey": str(report_id),
        "fileName": file_name,
        "storedEventCount": inserted,
        "skippedDuplicateEventCount": duplicates,
    }


def save_reports(database_path: Path, entries: list[dict], client_ip: str) -> dict:
    with WRITE_LOCK:
        connection = connect_database(database_path)
        try:
            connection.execute("BEGIN IMMEDIATE")
            run_id = connection.execute(
                "INSERT INTO import_runs(source_root,txt_files_found,notes) VALUES(?,?,?)",
                (f"web://{client_ip}", len(entries), "Shared LAN web upload"),
            ).lastrowid
            results = [insert_web_report(connection, run_id, entry, client_ip) for entry in entries]
            saved = sum(item["status"] == "saved" for item in results)
            duplicate = sum(item["status"] in ("duplicate", "duplicate_overlap") for item in results)
            invalid = sum(item["status"] == "invalid" for item in results)
            event_rows_read = sum(
                item["storedEventCount"] + item["skippedDuplicateEventCount"] for item in results
            )
            event_rows_inserted = sum(item["storedEventCount"] for item in results)
            event_rows_duplicate = sum(item["skippedDuplicateEventCount"] for item in results)
            connection.execute(
                """UPDATE import_runs SET finished_at=CURRENT_TIMESTAMP,status='completed',
                       files_imported=?,files_duplicate=?,files_invalid=?,event_rows_read=?,
                       event_rows_inserted=?,event_rows_duplicate=? WHERE import_run_id=?""",
                (
                    saved, duplicate, invalid, event_rows_read,
                    event_rows_inserted, event_rows_duplicate, run_id,
                ),
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
    return {
        "results": results,
        "savedCount": saved,
        "duplicateCount": duplicate,
        "invalidCount": invalid,
        "skippedDuplicateEventCount": event_rows_duplicate,
        "skippedOverlapEventCount": event_rows_duplicate,
        "storedEventCount": event_rows_inserted,
        "savedReportKeys": [item["reportKey"] for item in results if item["status"] == "saved"],
    }


class CCBRequestHandler(BaseHTTPRequestHandler):
    server_version = "CCBFaultAnalyser/3.0"

    @property
    def database_path(self) -> Path:
        return self.server.database_path  # type: ignore[attr-defined]

    def log_message(self, format_string: str, *args: object) -> None:
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{timestamp}] {self.client_address[0]} {format_string % args}", flush=True)

    def send_bytes(
        self,
        status: HTTPStatus,
        body: bytes,
        content_type: str,
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        self.send_response(status.value)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store" if content_type.startswith("application/json") else "no-cache")
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status: HTTPStatus, value: object) -> None:
        self.send_bytes(status, json_bytes(value), "application/json; charset=utf-8")

    def send_error_json(self, status: HTTPStatus, message: str) -> None:
        self.send_json(status, {"error": message})

    def do_GET(self) -> None:  # noqa: N802
        request = urlsplit(self.path)
        if request.path.startswith("/api/"):
            self.handle_api_get(request.path, parse_qs(request.query))
            return
        file_name = STATIC_FILES.get(request.path)
        if not file_name:
            self.send_error_json(HTTPStatus.NOT_FOUND, "Page not found.")
            return
        file_path = APP_ROOT / file_name
        try:
            body = file_path.read_bytes()
        except OSError:
            self.send_error_json(HTTPStatus.NOT_FOUND, "Application file not found.")
            return
        content_type = mimetypes.guess_type(file_name)[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type in ("application/javascript", "text/javascript"):
            content_type += "; charset=utf-8"
        self.send_bytes(HTTPStatus.OK, body, content_type)

    def handle_api_get(self, path: str, query: dict[str, list[str]]) -> None:
        connection = connect_database(self.database_path)
        try:
            if path == "/api/health":
                summary = get_summary(connection)
                self.send_json(HTTPStatus.OK, {"status": "ok", "database": self.database_path.name, **summary})
            elif path == "/api/locomotives":
                self.send_json(HTTPStatus.OK, get_locomotives(connection))
            elif path == "/api/summary":
                self.send_json(HTTPStatus.OK, get_summary(connection))
            elif path == "/api/reports":
                locomotive = unquote((query.get("locomotive") or [""])[0]).strip()
                if not locomotive:
                    self.send_error_json(HTTPStatus.BAD_REQUEST, "A locomotive number is required.")
                else:
                    self.send_json(HTTPStatus.OK, get_reports(connection, locomotive))
            elif path == "/api/events":
                locomotive = unquote((query.get("locomotive") or [""])[0]).strip()
                direction = (query.get("direction") or ["desc"])[0]
                if not locomotive:
                    self.send_error_json(HTTPStatus.BAD_REQUEST, "A locomotive number is required.")
                elif direction not in ("asc", "desc"):
                    self.send_error_json(HTTPStatus.BAD_REQUEST, "Direction must be asc or desc.")
                else:
                    self.send_json(HTTPStatus.OK, get_events(connection, locomotive, direction))
            elif path == "/api/fault-matrix":
                self.send_json(HTTPStatus.OK, get_fault_matrix(connection))
            else:
                self.send_error_json(HTTPStatus.NOT_FOUND, "API endpoint not found.")
        except Exception as error:
            self.log_error("API GET failure: %s", error)
            self.send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, "The shared database request failed.")
        finally:
            connection.close()

    def do_POST(self) -> None:  # noqa: N802
        request = urlsplit(self.path)
        if request.path != "/api/reports":
            self.send_error_json(HTTPStatus.NOT_FOUND, "API endpoint not found.")
            return
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            self.send_error_json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "Content-Type must be application/json.")
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            content_length = 0
        if content_length <= 0:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "The request body is empty.")
            return
        if content_length > MAX_REQUEST_BYTES:
            self.send_error_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "Upload exceeds the 128 MB request limit.")
            return
        try:
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            entries = payload.get("entries") if isinstance(payload, dict) else None
            if not isinstance(entries, list) or not entries:
                raise ValueError("At least one report is required.")
            if len(entries) > MAX_REPORTS_PER_REQUEST:
                raise ValueError(f"A single upload may contain at most {MAX_REPORTS_PER_REQUEST} reports.")
            if any(not isinstance(entry, dict) or not entry.get("rawText") for entry in entries):
                raise ValueError("Every report must include fileName and rawText values.")
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(error))
            return
        try:
            result = save_reports(self.database_path, entries, self.client_address[0])
            self.send_json(HTTPStatus.OK, result)
        except Exception as error:
            self.log_error("Upload failure: %s", error)
            self.send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, "The reports could not be saved to the shared database.")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT.value)
        self.send_header("Allow", "GET, POST, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()


class CCBServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], database_path: Path):
        self.database_path = database_path
        super().__init__(address, CCBRequestHandler)


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve CCB Fault Analyser to a LAN with shared SQLite storage.")
    parser.add_argument("--host", default="0.0.0.0", help="Listen address (default: all network interfaces)")
    parser.add_argument("--port", type=int, default=8080, help="HTTP port (default: 8080)")
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE, help="Shared SQLite database path")
    parser.add_argument("--advertise-host", default="", help="IP address shown in the startup message")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")
    database_path = args.database.resolve()
    migrate_database(database_path)
    try:
        server = CCBServer((args.host, args.port), database_path)
    except OSError as error:
        print(f"Unable to start the CCB server on {args.host}:{args.port}: {error}", file=sys.stderr)
        return 1
    shown_host = args.advertise_host or ("127.0.0.1" if args.host == "0.0.0.0" else args.host)
    print("CCB Fault Analyser shared LAN server", flush=True)
    print(f"URL:      http://{shown_host}:{args.port}/", flush=True)
    print(f"Listening on {args.host}:{args.port}", flush=True)
    print(f"Database: {database_path}", flush=True)
    print("Press Ctrl+C to stop.", flush=True)

    def request_shutdown(signum: int, frame: object) -> None:
        print(f"\nReceived signal {signum}; stopping server...", flush=True)
        threading.Thread(target=server.shutdown, daemon=True).start()

    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, request_shutdown)
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        print("\nStopping server...", flush=True)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
