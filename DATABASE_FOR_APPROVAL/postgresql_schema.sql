-- CCB Fleet Database - PostgreSQL approval schema
-- DESIGN ONLY: executing this file creates empty tables; it imports no TXT data.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS ccb;
SET search_path TO ccb, public;

CREATE TABLE schema_metadata (
    schema_version      integer PRIMARY KEY,
    applied_at          timestamptz NOT NULL DEFAULT now(),
    description         text NOT NULL
);
INSERT INTO schema_metadata (schema_version, description)
VALUES (2, 'CCB fleet Event Log schema with fault-occurrence identity protection');

CREATE TABLE locomotives (
    locomotive_number   varchar(20) PRIMARY KEY,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    notes               text
);

CREATE TABLE import_runs (
    import_run_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_kind          varchar(30) NOT NULL CHECK (source_kind IN ('manual_upload', 'drive_agent', 'indexeddb_migration', 'api')),
    source_reference     text,
    started_at           timestamptz NOT NULL DEFAULT now(),
    completed_at         timestamptz,
    status               varchar(20) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'completed_with_errors', 'failed')),
    files_discovered     integer NOT NULL DEFAULT 0 CHECK (files_discovered >= 0),
    files_accepted       integer NOT NULL DEFAULT 0 CHECK (files_accepted >= 0),
    files_duplicate      integer NOT NULL DEFAULT 0 CHECK (files_duplicate >= 0),
    files_error          integer NOT NULL DEFAULT 0 CHECK (files_error >= 0),
    events_inserted      bigint NOT NULL DEFAULT 0 CHECK (events_inserted >= 0),
    events_duplicate_skipped bigint NOT NULL DEFAULT 0 CHECK (events_duplicate_skipped >= 0)
);

CREATE TABLE import_files (
    import_file_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    import_run_id        uuid NOT NULL REFERENCES import_runs(import_run_id) ON DELETE CASCADE,
    drive_file_id        text,
    drive_source_path    text,
    original_filename    text NOT NULL,
    normalized_filename  text,
    folder_locomotive    varchar(20),
    filename_locomotive  varchar(20),
    effective_locomotive varchar(20),
    source_group         varchar(20),
    byte_count           bigint CHECK (byte_count >= 0),
    content_sha256       char(64),
    discovered_at        timestamptz NOT NULL DEFAULT now(),
    status               varchar(30) NOT NULL CHECK (status IN ('discovered', 'downloaded', 'accepted', 'duplicate_report', 'duplicate_only', 'partial_duplicate', 'parse_error', 'download_error', 'rejected')),
    error_message        text,
    UNIQUE (import_file_id, effective_locomotive)
);
CREATE INDEX ix_import_files_run_status ON import_files(import_run_id, status);
CREATE INDEX ix_import_files_effective_loco ON import_files(effective_locomotive);

CREATE TABLE reports (
    report_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    import_file_id       uuid NOT NULL UNIQUE,
    locomotive_number   varchar(20) NOT NULL REFERENCES locomotives(locomotive_number) ON DELETE RESTRICT,
    software_version     text,
    raw_text             text NOT NULL,
    raw_content_sha256   char(64) NOT NULL,
    datetime_sequence_sha256 char(64) NOT NULL,
    source_event_count   integer NOT NULL CHECK (source_event_count >= 0),
    stored_event_count   integer NOT NULL CHECK (stored_event_count >= 0),
    duplicate_event_count integer NOT NULL DEFAULT 0 CHECK (duplicate_event_count >= 0),
    malformed_row_count  integer NOT NULL DEFAULT 0 CHECK (malformed_row_count >= 0),
    first_event_at       timestamp without time zone,
    last_event_at        timestamp without time zone,
    imported_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (locomotive_number, report_id),
    UNIQUE (locomotive_number, datetime_sequence_sha256),
    UNIQUE (locomotive_number, raw_content_sha256),
    FOREIGN KEY (import_file_id, locomotive_number)
        REFERENCES import_files(import_file_id, effective_locomotive)
        ON DELETE RESTRICT,
    CHECK (stored_event_count + duplicate_event_count + malformed_row_count <= source_event_count),
    CHECK (first_event_at IS NULL OR last_event_at IS NULL OR first_event_at <= last_event_at)
);
CREATE INDEX ix_reports_loco_latest ON reports(locomotive_number, last_event_at DESC);
CREATE INDEX ix_reports_imported ON reports(imported_at DESC);

-- The importer creates the report before it can claim event seconds, so exact
-- counter equality must be checked at transaction commit rather than at the
-- initial INSERT. Querying the current row also makes repeated updates within
-- the same transaction safe when this deferred trigger eventually runs.
CREATE FUNCTION enforce_report_event_count_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    current_source_count    integer;
    current_stored_count    integer;
    current_duplicate_count integer;
    current_malformed_count integer;
BEGIN
    SELECT source_event_count, stored_event_count,
           duplicate_event_count, malformed_row_count
      INTO current_source_count, current_stored_count,
           current_duplicate_count, current_malformed_count
      FROM ccb.reports
     WHERE report_id = NEW.report_id;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    IF current_stored_count + current_duplicate_count + current_malformed_count
       <> current_source_count THEN
        RAISE EXCEPTION
            'Report % event counts are unbalanced: source %, stored %, duplicate %, malformed %',
            NEW.report_id, current_source_count, current_stored_count,
            current_duplicate_count, current_malformed_count;
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ck_reports_event_count_balance
AFTER INSERT OR UPDATE ON reports
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_report_event_count_balance();

-- Each locomotive + fault-start second + event code + state has one owner.
-- This permits distinct faults in the same second and preserves Fail/Pass rows,
-- while rejecting the same logical row from overlapping source files.
CREATE TABLE event_occurrences (
    locomotive_number   varchar(20) NOT NULL REFERENCES locomotives(locomotive_number) ON DELETE RESTRICT,
    occurrence_timestamp timestamp without time zone NOT NULL,
    event_code           varchar(20) NOT NULL,
    event_state          varchar(10) NOT NULL CHECK (event_state IN ('on', 'fail', 'pass')),
    owner_report_id     uuid NOT NULL,
    allocated_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (locomotive_number, occurrence_timestamp, event_code, event_state),
    UNIQUE (locomotive_number, occurrence_timestamp, event_code, event_state, owner_report_id),
    FOREIGN KEY (locomotive_number, owner_report_id)
        REFERENCES reports(locomotive_number, report_id)
        ON DELETE CASCADE
);

CREATE TABLE event_log (
    event_id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    report_id            uuid NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
    locomotive_number   varchar(20) NOT NULL,
    event_timestamp     timestamp without time zone NOT NULL,
    occurrence_timestamp timestamp without time zone NOT NULL,
    source_timestamp     varchar(32) NOT NULL,
    original_row_index   integer NOT NULL CHECK (original_row_index >= 0),
    source_record        varchar(3) NOT NULL,
    event_code           varchar(20) NOT NULL,
    description          text NOT NULL,
    event_state          varchar(10) NOT NULL CHECK (event_state IN ('on', 'fail', 'pass')),
    mode                 varchar(20) NOT NULL,
    cleared_at           timestamp without time zone,
    duration_ms          bigint CHECK (duration_ms IS NULL OR duration_ms >= 0),
    created_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (report_id, original_row_index),
    FOREIGN KEY (locomotive_number, occurrence_timestamp, event_code, event_state, report_id)
        REFERENCES event_occurrences(locomotive_number, occurrence_timestamp, event_code, event_state, owner_report_id)
        ON DELETE CASCADE
);
CREATE INDEX ix_event_log_loco_latest ON event_log(locomotive_number, event_timestamp DESC);
CREATE INDEX ix_event_log_loco_occurrence ON event_log(locomotive_number, occurrence_timestamp DESC);
CREATE INDEX ix_event_log_loco_state_latest ON event_log(locomotive_number, event_state, event_timestamp DESC);
CREATE INDEX ix_event_log_code_latest ON event_log(event_code, event_timestamp DESC);
CREATE INDEX ix_event_log_description_search ON event_log USING gin(to_tsvector('simple', description));

CREATE TABLE event_environment (
    event_id bigint PRIMARY KEY REFERENCES event_log(event_id) ON DELETE CASCADE,
    mrt_raw text, mrt_psi numeric(12,1), mrt_kg_cm2 numeric(12,3),
    bpt_raw text, bpt_psi numeric(12,1), bpt_kg_cm2 numeric(12,3),
    bpalt_raw text, bpalt_psi numeric(12,1), bpalt_kg_cm2 numeric(12,3),
    ert_raw text, ert_psi numeric(12,1), ert_kg_cm2 numeric(12,3),
    tl20_raw text, tl20_psi numeric(12,1), tl20_kg_cm2 numeric(12,3),
    tt20_raw text, tt20_psi numeric(12,1), tt20_kg_cm2 numeric(12,3),
    t10_raw text, t10_psi numeric(12,1), t10_kg_cm2 numeric(12,3),
    bct_raw text, bct_psi numeric(12,1), bct_kg_cm2 numeric(12,3),
    flt_raw text, flt_psi numeric(12,1), flt_kg_cm2 numeric(12,3)
);

CREATE TABLE duplicate_rejections (
    duplicate_rejection_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    incoming_report_id   uuid NOT NULL,
    locomotive_number   varchar(20) NOT NULL,
    occurrence_timestamp timestamp without time zone NOT NULL,
    event_code           varchar(20) NOT NULL,
    event_state          varchar(10) NOT NULL CHECK (event_state IN ('on', 'fail', 'pass')),
    existing_owner_report_id uuid NOT NULL,
    incoming_row_count   integer NOT NULL CHECK (incoming_row_count > 0),
    reason               text NOT NULL DEFAULT 'Locomotive, fault-start second, event code and state already stored',
    rejected_at          timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (locomotive_number, incoming_report_id)
        REFERENCES reports(locomotive_number, report_id)
        ON DELETE CASCADE,
    FOREIGN KEY (locomotive_number, occurrence_timestamp, event_code, event_state, existing_owner_report_id)
        REFERENCES event_occurrences(locomotive_number, occurrence_timestamp, event_code, event_state, owner_report_id)
        ON DELETE CASCADE
);
CREATE INDEX ix_duplicate_rejections_loco_time ON duplicate_rejections(locomotive_number, occurrence_timestamp DESC);

CREATE TABLE loading_log (
    loading_log_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    report_id            uuid NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
    sequence_number      integer NOT NULL,
    installed_date       date,
    installed_time       time without time zone,
    user_id              text,
    source_filename      text,
    installed_version    text,
    UNIQUE (report_id, sequence_number)
);

CREATE TABLE stored_fault_log (
    stored_fault_log_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    report_id            uuid NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
    sequence_number      integer NOT NULL,
    current_status       text,
    failure_count        integer CHECK (failure_count IS NULL OR failure_count >= 0),
    last_failed_at       timestamp without time zone,
    last_cleared_at      timestamp without time zone,
    fault_code           text,
    description          text,
    UNIQUE (report_id, sequence_number)
);

CREATE TABLE import_errors (
    import_error_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    import_run_id        uuid NOT NULL REFERENCES import_runs(import_run_id) ON DELETE CASCADE,
    import_file_id       uuid REFERENCES import_files(import_file_id) ON DELETE CASCADE,
    stage                varchar(30) NOT NULL,
    severity             varchar(10) NOT NULL CHECK (severity IN ('warning', 'error')),
    message              text NOT NULL,
    technical_detail     text,
    created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_import_errors_run ON import_errors(import_run_id, severity, created_at);

CREATE VIEW v_event_log_full AS
SELECT e.event_id, e.locomotive_number, e.event_timestamp, e.source_record,
       e.occurrence_timestamp, e.event_code, e.description, e.event_state, e.mode, e.cleared_at,
       e.duration_ms, r.software_version, f.normalized_filename,
       p.mrt_kg_cm2, p.bpt_kg_cm2, p.bpalt_kg_cm2, p.ert_kg_cm2,
       p.tl20_kg_cm2, p.tt20_kg_cm2, p.t10_kg_cm2, p.bct_kg_cm2,
       p.flt_kg_cm2
FROM event_log e
JOIN reports r ON r.report_id = e.report_id
JOIN import_files f ON f.import_file_id = r.import_file_id
LEFT JOIN event_environment p ON p.event_id = e.event_id;

CREATE VIEW v_locomotive_summary AS
SELECT l.locomotive_number,
       count(DISTINCT r.report_id) AS report_count,
       count(e.event_id) AS event_count,
       count(e.event_id) FILTER (WHERE lower(e.event_state) = 'fail') AS fault_count,
       min(e.event_timestamp) AS first_event_at,
       max(e.event_timestamp) AS last_event_at
FROM locomotives l
LEFT JOIN reports r ON r.locomotive_number = l.locomotive_number
LEFT JOIN event_log e ON e.report_id = r.report_id
GROUP BY l.locomotive_number;

-- Source for the fleet-wide Analysis of Data matrix. The application pivots
-- these rows so fault names are rows and locomotive numbers are columns.
CREATE VIEW v_fault_counts_by_locomotive AS
SELECT e.event_code, e.description AS fault_name, e.locomotive_number,
       count(*) AS occurrence_count
FROM event_log e
WHERE lower(e.event_state) = 'fail'
GROUP BY e.event_code, e.description, e.locomotive_number;

COMMIT;
