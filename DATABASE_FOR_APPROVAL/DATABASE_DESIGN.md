# CCB Fleet Server Database — Approval Draft

Status: **schema only; no TXT data has been imported into PostgreSQL**.

Recommended production engine: PostgreSQL. It will sit behind a secured backend API; internet users will never receive direct database credentials. The offline EXE currently stores equivalent data in the browser's local IndexedDB.

## Tables and responsibilities

- `locomotives`: one master row per locomotive number.
- `import_runs`: one single, bulk-folder, Drive-agent, or API import session and its census totals.
- `import_files`: every TXT attempt, including accepted, duplicate, invalid, and error files.
- `reports`: one accepted parsed report, including software version, raw TXT, hashes, date range, and row counts.
- `event_occurrences`: the concurrency-safe owner of each logical Event Log identity.
- `event_log`: every accepted On, Fail, and Pass row in chronological history.
- `event_environment`: the nine transducer values associated one-to-one with an Event Log row.
- `duplicate_rejections`: each incoming event identity skipped because it was already stored.
- `loading_log`: software installation history, kept separate from Event Log.
- `stored_fault_log`: cumulative Fault Log Data, kept separate from Event Log.
- `import_errors`: parse errors, locomotive mismatches, warnings, and technical details.

## Final duplicate identity

The database-level unique key is:

`locomotive_number + occurrence_timestamp + event_code + event_state`

For a Fail row, `occurrence_timestamp` is its own printed fault-start timestamp. For the matching Pass/recovery row, it is the paired Fail start timestamp. For an On row, it is the On row timestamp.

Consequences:

- The same locomotive, same fault, and same fault-start second is stored only once, even when repeated inside one TXT, repeated in overlapping TXT files, or submitted by simultaneous import processes.
- Two different event codes in the same second remain valid.
- Fail and Pass remain distinct rows because state is part of the identity, but they point to the same occurrence start time.
- The displayed chronological order uses `event_timestamp`; duplicate identity uses `occurrence_timestamp`.

The primary key on `event_occurrences (locomotive_number, occurrence_timestamp, event_code, event_state)` is the final protection. Application checks improve reporting, but correctness does not depend on them.

## Transaction used for every accepted file

1. Create the `reports` row.
2. Normalize and pair Fail/Pass rows to determine each occurrence start time.
3. Claim identities using `INSERT ... ON CONFLICT DO NOTHING` in `event_occurrences`.
4. Insert `event_log` and `event_environment` only for identities claimed by this report.
5. Record each unclaimed identity in `duplicate_rejections` and update report/file counters.
6. Commit only when `stored_event_count + duplicate_event_count + malformed_row_count = source_event_count`; the deferred trigger rolls back an unbalanced transaction.

One transaction prevents two upload windows or server workers from both accepting the same occurrence.

## Locomotive resolution

When a TXT contains a valid locomotive number, that value is authoritative even if its folder differs. Otherwise the locomotive-number folder is used. Folder, filename, and effective locomotive values are retained so a mismatch is auditable rather than silently discarded.

## Environment values

`event_environment` stores raw text, interpreted PSI, and converted kg/cm² separately for MRT, BPT, BPalt, ERT, 20TL, 20TT, 10T, BCT, and FLT. The raw value is never discarded after conversion.

## Time and ordering

CCB timestamps contain no timezone offset, so source event times use `timestamp without time zone` to preserve the printed value. Server audit times such as `imported_at` use `timestamptz`. The configured operating timezone is Asia/Kolkata.

Indexes return latest events first by default. The UI may reverse to oldest-first when explicitly selected.

## Analysis of Data matrix

`v_fault_counts_by_locomotive` counts only Fail rows, grouped by event code, fault name, and locomotive. The application pivots it into:

- rows: fault names;
- columns: locomotive numbers;
- cells: occurrence counts;
- final column: total across the fleet;
- row order: total descending.

Pass recoveries and On/power-up events remain in Event Log but are not counted as fault activations.

## Server deployment

The SQL file is portable and contains no report data or passwords. On deployment it creates schema `ccb` inside a PostgreSQL database such as `ccb_fleet`. Backups should use encrypted server snapshots and `pg_dump`.

Before production import, test exact duplicates, duplicates within one TXT, partial overlap, different faults in the same second, matching Fail/Pass, and simultaneous imports.
