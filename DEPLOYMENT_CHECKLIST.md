# MIS Report — Deployment Checklist

Everything that must be done before the Report module goes live, in order.
Tick each box when done. Do not skip a phase: each one depends on the one before.

---

## Phase 1 — Database access (blocker for everything else)

- [ ] **1.1** Ask the SIT admin for a Postgres user on `sit_lwms` with:
  - READ on schemas `cms`, `auth`, `digiserve`, `courtbridge`, `workflow`
  - CREATE/READ/WRITE on the three new tables `cms.report_templates`, `cms.report_schedules`, `cms.report_history`
- [ ] **1.2** Confirm you can reach the database from your machine (VPN / SSH tunnel if DBeaver uses one).
- [ ] **1.3** Fill `backend/.env`: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` (`DB_SSL=true` if SIT requires SSL).
- [ ] **1.4** Find your user id and put it in `MIS_DEV_USER_ID`:
  ```sql
  SELECT id FROM auth.account WHERE email = 'aleem.rayeen@presolv360.com';
  ```

## Phase 2 — Set up the database

- [ ] **2.1** If an old version of the MIS tables exists on SIT, drop them (see top of `database/migrations.sql`).
- [ ] **2.2** Run **Part 1** of `database/migrations.sql` (creates the 3 tables).
- [ ] **2.3** Check the indexes in **Part 2** against what already exists (`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname IN ('cms','digiserve','courtbridge');`). Skip duplicates.
- [ ] **2.4** Run **Part 2** with auto-commit ON (DBeaver "Auto" button). Large tables may take minutes per index.
- [ ] **2.5** `cd backend && npm start` — must print `[mis] API listening…` with no "Cannot start" list.

## Phase 3 — Verify the data (most important)

- [ ] **3.1** Run the 7 checks in the "Things to confirm on the database" table at the top of `LITELO_COLUMNS.md`. For each wrong assumption, fix `backend/config/column-catalog.js` (e.g. `'sms'` → `'SMS'`).
- [ ] **3.2** Build one test template with **all 88 columns** for a client with real cases, date range = last 3 months.
- [ ] **3.3** Preview it. For each column, open 3–5 cases in the Litelo UI and compare the values. Tick the column in `LITELO_COLUMNS.md`.
- [ ] **3.4** Any column that is always empty → find out why (wrong source column, wrong join, data not captured) and fix or remove it.
- [ ] **3.5** Confirm **row count** = number of cases: compare the preview total with
  ```sql
  SELECT count(*) FROM cms.cheque WHERE enterprise_id = '<id>' AND notice_date >= '<from>' AND notice_date < '<to>'::date + 1;
  ```
- [ ] **3.6** Test each filter type once (text, number, date, "last N days", yes/no) and check the row count changes as expected.
- [ ] **3.7** Check dates are correct in India time: a case created at 00:30 IST on the 1st must count in the 1st, not the previous day.
- [ ] **3.8** Run `npm run docs:columns` after any catalog change and commit the updated `LITELO_COLUMNS.md`.

## Phase 4 — Performance on real volume

- [ ] **4.1** Find the client with the most cases. Preview a 1-year range — it should return within ~10 seconds.
- [ ] **4.2** Download that range as CSV and as Excel. Note time and file size.
- [ ] **4.3** If slow: run `EXPLAIN ANALYZE` on the query (log it from `utils/query-builder.js`) and add the missing index; most often it is the date basis index on `cms.cheque`.
- [ ] **4.4** Start 3 large exports at once — check the server stays responsive and memory stays under ~500 MB.
- [ ] **4.5** Decide `MIS_MAX_CONCURRENT_EXPORTS` and `MIS_EXPORT_TIMEOUT_MINUTES` for production from these numbers.

## Phase 5 — Integrate into the Litelo platform

Backend (with the platform team):
- [ ] **5.1** Copy the backend folders into the Litelo backend (see `INTEGRATION_GUIDE.md` §4).
- [ ] **5.2** Point `db/pool.js` at Litelo's existing Postgres pool.
- [ ] **5.3** Mount `/api/mis` **after** Litelo's auth middleware; confirm it sets `req.user = { id, email }`.
- [ ] **5.4** Remove `MIS_DEV_USER_ID` from every server's environment (dev only — it bypasses login).
- [ ] **5.5** Start the export worker and scheduler at app startup; set `MIS_RUN_WORKERS=false` on servers that should not run them.
- [ ] **5.6** Remove the open `cors()` if the frontend and API are on the same domain, or restrict it to the Litelo domain.

Frontend:
- [ ] **5.7** Copy `services/mis-api.js` and `components/mis/` into the Litelo frontend; add route `/platform/report` and the "Report" sidebar item.
- [ ] **5.8** Confirm the API accepts the session **cookie** — file downloads use a plain link and cannot send a bearer token. If Litelo uses bearer tokens, a short-lived signed download URL must be added to `GET /history/:id/file`.
- [ ] **5.9** Check the screens inside the real Litelo layout (sidebar, header, dark mode).

## Phase 6 — Access control

- [ ] **6.1** Decide (open question in `MIS Report.md`): Litelo team only, or client users too?
- [ ] **6.2** If client users: implement `assertEnterpriseAccess` in `backend/middleware/auth.js` using `auth.member` / `auth.member_org_access`, so a user only sees their own organisation.
- [ ] **6.3** Decide who may create/edit/delete templates vs. only download; add the role check in the routes.
- [ ] **6.4** Test: user of enterprise A calls the API with enterprise B's id → must get 403.

## Phase 7 — File storage

- [ ] **7.1** How many backend servers run in production? If more than one: put `MIS_EXPORT_DIR` on a shared volume, or replace `services/file-storage.js` with S3 (keep the same function names).
- [ ] **7.2** Make sure the export folder has enough disk for 90 days of files (estimate from Phase 4 sizes × downloads per day).
- [ ] **7.3** Make sure the folder is not publicly served and is included/excluded from backups as policy requires (files contain borrower personal data).

## Phase 8 — Email

- [ ] **8.1** Get SMTP / AWS SES credentials and a verified sender address (`MIS_EMAIL_FROM`).
- [ ] **8.2** Decide the attachment limit (`MIS_EMAIL_MAX_ATTACHMENT_MB`, default 20) — larger files send a "download from History" note instead.
- [ ] **8.3** Decide (open question): restrict recipients to the client's email domains? If yes, add the check in `validateSchedule` (`backend/utils/validators.js`).
- [ ] **8.4** Create a schedule to your own address: first email arrives at once, attachment opens.
- [ ] **8.5** Set a daily schedule for a time 2 minutes ahead; confirm it arrives once, and `next_run_at` moves to the next day.
- [ ] **8.6** Cancel the schedule; confirm nothing more is sent.

## Phase 9 — Product decisions to close

- [ ] **9.1** Column reordering: keep (prototype) or remove (spec says out of scope for v1)?
- [ ] **9.2** Section 25 and SARFAESI: confirm their base tables, then add their column groups (`config/workflows.js`, `config/column-catalog.js`).
- [ ] **9.3** Missing columns listed at the bottom of `LITELO_COLUMNS.md` (Batch ID, Cheque amount, notice delivery, settlement, legal cost…): which are needed for launch, and where is that data stored?
- [ ] **9.4** Ageing bucket: confirm ranges and that it counts from case creation date.

## Phase 10 — Testing and sign-off

- [ ] **10.1** `cd backend && npm test` — all pass.
- [ ] **10.2** Full manual run on SIT, every user story in `MIS Report.md` (US-1.1 to US-4.4).
- [ ] **10.3** Error cases: Draft template not in Download list; deleted template's history still downloadable; file older than 90 days shows "Run with latest data"; invalid email rejected.
- [ ] **10.4** Restart the backend while an export is running → it is marked failed within 15 minutes, not stuck on "Building".
- [ ] **10.5** QA sign-off on SIT.
- [ ] **10.6** Security review of the module (access control, file storage, email recipients).

## Phase 11 — Go live

- [ ] **11.1** Run `database/migrations.sql` on production (Part 2 during low traffic).
- [ ] **11.2** Set production environment variables (no `MIS_DEV_USER_ID`, real SMTP, export dir/S3).
- [ ] **11.3** Deploy backend + frontend.
- [ ] **11.4** Smoke test: build one template, preview, download Excel and CSV, check History.
- [ ] **11.5** Watch logs for `[export]` and `[scheduler]` errors for the first week.
- [ ] **11.6** Delete the test templates and schedules created during testing.
