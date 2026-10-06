-- ============================================================================
-- MIS REPORT MODULE — DATABASE SETUP (Postgres, database sit_lwms, schema cms)
-- ============================================================================
-- Run PART 1 once. Run PART 2 once, with auto-commit ON (DBeaver: the "Auto"
-- commit button), because CREATE INDEX CONCURRENTLY cannot run inside a transaction.
--
-- If you ran the OLD version of this file on SIT, drop those tables first:
--   DROP TABLE IF EXISTS cms.report_history, cms.report_schedules, cms.report_templates;
-- ============================================================================


-- ============================================================================
-- PART 1 — MIS tables
-- ============================================================================

-- One row = one saved report definition, e.g. "Notice dispatch tracker" for ABC Bank.
CREATE TABLE IF NOT EXISTS cms.report_templates (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text NOT NULL,
    description   text,
    enterprise_id uuid NOT NULL,                        -- auth.organization.id
    workflow      text NOT NULL,                        -- 'section138' | 'section25' | 'sarfaesi'
    date_basis    text NOT NULL,                        -- catalog key of the date the range is matched on
    status        text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Active', 'Draft')),
    columns       jsonb NOT NULL DEFAULT '[]',          -- [{"key":"borrower_name","label":"Borrower","mv":"latest"}]
    filters       jsonb NOT NULL DEFAULT '[]',          -- [{"key":"case_status","op":"is","value":"Open"}]
    created_by    uuid NOT NULL,                        -- auth.account.id
    updated_by    uuid NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Name is unique per enterprise, ignoring case ("Court Pipeline" = "court pipeline").
CREATE UNIQUE INDEX IF NOT EXISTS report_templates_name_per_enterprise
    ON cms.report_templates (enterprise_id, lower(name));
CREATE INDEX IF NOT EXISTS report_templates_enterprise_workflow
    ON cms.report_templates (enterprise_id, workflow);


-- One row = one repeating email of a report.
CREATE TABLE IF NOT EXISTS cms.report_schedules (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id   uuid NOT NULL REFERENCES cms.report_templates (id) ON DELETE CASCADE,
    frequency     text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
    send_time     time NOT NULL,                        -- India time, e.g. 09:00
    end_date      date NOT NULL,                        -- last day an email may go out
    recipients    text[] NOT NULL,
    format        text NOT NULL CHECK (format IN ('xlsx', 'csv')),
    range_days    int  NOT NULL CHECK (range_days BETWEEN 1 AND 3660),  -- each email covers this many days, ending on the send date
    next_run_at   timestamptz NOT NULL,                 -- when the scheduler sends next
    last_run_at   timestamptz,
    created_by    uuid NOT NULL,
    updated_by    uuid NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS report_schedules_template ON cms.report_schedules (template_id);
CREATE INDEX IF NOT EXISTS report_schedules_due      ON cms.report_schedules (next_run_at);


-- One row = one file built (downloaded or emailed). Also used as the export job queue:
-- status goes queued -> running -> done | failed.
-- Template name and enterprise name are copied in, so History still reads correctly after a template is renamed or deleted.
CREATE TABLE IF NOT EXISTS cms.report_history (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id     uuid REFERENCES cms.report_templates (id) ON DELETE SET NULL,
    schedule_id     uuid REFERENCES cms.report_schedules (id) ON DELETE SET NULL,
    template_name   text NOT NULL,
    enterprise_id   uuid NOT NULL,
    enterprise_name text NOT NULL,
    workflow        text NOT NULL,
    date_from       date NOT NULL,
    date_to         date NOT NULL,
    format          text NOT NULL CHECK (format IN ('xlsx', 'csv')),
    delivery        text NOT NULL CHECK (delivery IN ('Download', 'Email')),
    recipients      text[],                             -- for Email only
    status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
    row_count       bigint NOT NULL DEFAULT 0,
    file_name       text NOT NULL,                      -- name the user downloads, e.g. Court_pipeline_ABCBank_20260901.xlsx
    file_key        text,                               -- where the file is stored; NULL once deleted after the retention period
    file_size       bigint,
    error           text,
    generated_by    uuid NOT NULL,
    generated_at    timestamptz NOT NULL DEFAULT now(),
    started_at      timestamptz,
    completed_at    timestamptz,
    updated_at      timestamptz NOT NULL DEFAULT now()  -- heartbeat while running
);

CREATE INDEX IF NOT EXISTS report_history_enterprise_time ON cms.report_history (enterprise_id, generated_at DESC);
-- Small partial index: the worker's "next queued job" lookup stays instant however big History gets.
CREATE INDEX IF NOT EXISTS report_history_open_jobs ON cms.report_history (generated_at) WHERE status IN ('queued', 'running');


-- ============================================================================
-- PART 2 — indexes on EXISTING tables, so reports stay fast on millions of cases
-- ============================================================================
-- Each one supports a lookup the report queries do for every case.
-- CONCURRENTLY builds the index without locking the table for writes.
-- Check first with \di or pg_indexes — skip any that already exist under another name.

-- Every report filters by enterprise + its date basis. Add one per date basis your templates use.
CREATE INDEX CONCURRENTLY IF NOT EXISTS mis_cheque_ent_created     ON cms.cheque (enterprise_id, created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS mis_cheque_ent_notice      ON cms.cheque (enterprise_id, notice_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS mis_cheque_ent_filing      ON cms.cheque (enterprise_id, case_filing_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS mis_cheque_ent_memo        ON cms.cheque (enterprise_id, return_memo_date);

-- Per-case lookups used by Borrower, Proceedings, Drafts, Communication, Court columns.
CREATE INDEX CONCURRENTLY IF NOT EXISTS mis_litigants_case         ON cms.litigants (case_id, case_type);
CREATE INDEX CONCURRENTLY IF NOT EXISTS mis_litigant_addr_litigant ON cms.litigant_addresses (litigant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS mis_proceedings_case       ON cms.proceedings (case_id, case_type);
CREATE INDEX CONCURRENTLY IF NOT EXISTS mis_drafts_case            ON cms.drafts (case_id, case_type);
CREATE INDEX CONCURRENTLY IF NOT EXISTS mis_documents_case         ON cms.documents (case_id, case_type);
CREATE INDEX CONCURRENTLY IF NOT EXISTS mis_comm_request_case_mode ON digiserve.communication_request (case_id, communication_mode);
CREATE INDEX CONCURRENTLY IF NOT EXISTS mis_reply_case             ON digiserve.reply (case_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS mis_hearings_cnr           ON courtbridge.ecourt_case_hearings (cnr);
