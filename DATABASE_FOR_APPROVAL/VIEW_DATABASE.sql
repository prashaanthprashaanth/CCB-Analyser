-- Run individual statements in a VS Code SQLite viewer.

-- 1. Latest Event Log data first, including the nine kg/cm2 environment values.
SELECT *
FROM v_event_timeline
ORDER BY event_timestamp DESC
LIMIT 200;

-- 2. One locomotive, latest first. Replace 37546 as needed.
SELECT *
FROM v_event_timeline
WHERE locomotive_number = '37546'
ORDER BY event_timestamp DESC;

-- 3. Locomotive census.
SELECT *
FROM v_locomotive_summary
ORDER BY CAST(locomotive_number AS INTEGER);

-- 4. Fault x locomotive counts used by the Analysis of Data page.
SELECT *
FROM v_fault_locomotive_counts
ORDER BY occurrence_count DESC, fault_name, CAST(locomotive_number AS INTEGER);

-- 5. Fleet fault totals, highest occurrence first.
SELECT *
FROM v_fault_totals;

-- 6. Every source file and its import result.
SELECT source_filename, locomotive_number_detected, status,
       parsed_event_rows, inserted_event_rows, duplicate_event_rows,
       malformed_event_rows, message
FROM import_files
ORDER BY import_file_id;

-- 7. Rejected duplicate Event Log rows.
SELECT *
FROM duplicate_rejections
ORDER BY duplicate_rejection_id DESC;

-- 8. Invalid file details.
SELECT *
FROM import_errors
ORDER BY import_error_id DESC;

-- 9. Loading history.
SELECT l.locomotive_number, x.installed_at, x.user_id,
       x.filename, x.software_version, r.source_filename
FROM loading_log x
JOIN reports r ON r.report_id = x.report_id
JOIN locomotives l ON l.locomotive_id = r.locomotive_id
ORDER BY x.installed_at DESC;

-- 10. Stored Fault Log data (separate from Event Log data).
SELECT l.locomotive_number, x.current_status, x.failure_count,
       x.last_failed_at, x.last_cleared_at, x.fault_code,
       x.description, r.source_filename
FROM stored_fault_log x
JOIN reports r ON r.report_id = x.report_id
JOIN locomotives l ON l.locomotive_id = r.locomotive_id
ORDER BY x.last_failed_at DESC;

