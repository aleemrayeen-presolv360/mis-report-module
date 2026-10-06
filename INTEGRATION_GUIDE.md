# MIS Report Module — Integration Guide

How to run the Report module locally and plug it into the Litelo backend and frontend.
For what the module does (screens, user stories) see `MIS Report.md`. For every report column and its database source see `LITELO_COLUMNS.md`.

---

## 1. How it works

```
Browser (React)                     Backend (Express)                         Postgres (sit_lwms)
───────────────                     ─────────────────                         ───────────────────
Report templates  ── CRUD ────────▶ routes → template.service ─────────────▶ cms.report_templates
Report download   ── preview ─────▶ report.service (first 50 rows + count) ─▶ cms.cheque + lookups
                  ── export ──────▶ inserts a "queued" row ─────────────────▶ cms.report_history
                  ◀─ polls status ─ export-worker claims the job, streams
                  ◀─ file download ─  rows with a cursor into xlsx/csv
History           ── list/download ▶ history.service, file-storage
Email schedule    ── create ──────▶ schedule.service (sends first email now) ▶ cms.report_schedules
                                    scheduler (every minute) queues due emails
```

**Why files are built in the background:** a report can have millions of rows and take minutes. Building it inside the HTTP request would time out. Instead the API queues a job and returns at once; the browser shows progress and downloads the file when it is ready. The job queue is the `cms.report_history` table itself, so jobs survive a restart and several servers can share the work.

**Memory stays flat at any size.** Rows are read from Postgres 5,000 at a time through a cursor and written straight to disk. Measured on a laptop:

| Format | Rows | Time | Peak memory | File size |
|---|---|---|---|---|
| CSV | 3,000,000 | 6 s | 219 MB | 432 MB |
| Excel | 1,200,000 | 49 s | 259 MB | 82 MB |

(12 columns; time is file writing only — add your query time.) Excel's limit is 1,048,576 rows per sheet, so larger reports continue on sheets "Report (2)", "Report (3)"…

---

## 2. Folder structure

```
MIS/
├── LITELO_COLUMNS.md            ← every report column + DB source, as a checklist (generated)
├── database/migrations.sql      ← 3 MIS tables + recommended indexes on existing tables
├── backend/
│   ├── server.js                ← standalone server (API + workers)
│   ├── .env.example             ← all settings, documented
│   ├── config/
│   │   ├── env.js               ← reads .env
│   │   ├── workflows.js         ← Section 138 / 25 / SARFAESI → base table
│   │   ├── column-catalog.js    ← every column and its SQL  ← edit this to add columns
│   │   └── filter-operators.js  ← filter conditions per field type
│   ├── db/pool.js               ← Postgres pool, IST session helper
│   ├── middleware/              ← auth (req.user, enterprise access), error handler
│   ├── utils/
│   │   ├── query-builder.js     ← template + dates → SQL (parameterised)
│   │   ├── validators.js        ← all input checks, plain-English messages
│   │   └── dates.js             ← India-time date maths, schedule next-run
│   ├── services/                ← one file per table/concern
│   ├── jobs/
│   │   ├── export-worker.js     ← builds files from the queue
│   │   └── scheduler.js         ← due emails, stalled jobs, old-file cleanup
│   ├── routes/report.routes.js  ← every endpoint (/api/mis/...)
│   ├── scripts/generate-column-docs.js
│   └── tests/                   ← npm test
└── frontend/src/
    ├── services/mis-api.js      ← every API call
    └── components/mis/          ← MISReport (tabs) + one file per screen/part
```

---

## 3. Run it locally

You need Node 18+ and access to the SIT Postgres database.

1. **Database** — run `database/migrations.sql` in DBeaver (Part 2 needs auto-commit ON; see the comment at the top).
2. **Backend**
   ```bash
   cd backend
   cp .env.example .env        # fill DB_*, and MIS_DEV_USER_ID = your auth.account id
   npm install
   npm test                    # 23 tests, no database needed
   npm start                   # http://localhost:5000/api/mis
   ```
3. **Frontend**
   ```bash
   cd frontend
   npm install
   npm start                   # http://localhost:3000 (proxies /api to :5000)
   ```

Without `SMTP_HOST` in `.env`, scheduled emails are only logged, never sent.

**Only a read-only SIT user?** Run `npm run sit` (with the kubectl port-forward running and `DB_READ_ONLY=true` in `.env`). Report data comes from SIT; templates and history are kept in memory because the MIS tables cannot be created read-only. It refuses to start without `DB_READ_ONLY=true`.

**No database access yet?** Run `npm run demo` in `backend` instead of `npm start`. It serves the same API with sample data in memory (no `.env` needed), using the real column catalog, validation and Excel/CSV writers. Data is lost on restart and no emails are sent.

---

## 4. Put it into the Litelo backend

1. Copy `backend/config`, `db`, `middleware`, `utils`, `services`, `jobs`, `routes` into a `mis/` folder of the Litelo backend.
2. Install: `npm install pg pg-cursor exceljs nodemailer dotenv`
3. In `mis/db/pool.js`, export Litelo's existing pool instead of creating a new one (keep the `query`, `withReportSession` and `withTransaction` helpers).
4. Mount the routes **after** Litelo's auth middleware, which must set `req.user = { id, email }`:
   ```js
   app.use('/api/mis', require('./mis/routes/report.routes'));
   ```
5. Start the workers once at startup (on every server, or only on one — set `MIS_RUN_WORKERS=false` on the others):
   ```js
   require('./mis/jobs/export-worker').startExportWorker();
   require('./mis/jobs/scheduler').startScheduler();
   ```
6. **More than one server?** Files are on local disk (`MIS_EXPORT_DIR`). Point it at a shared volume, or replace `services/file-storage.js` with S3 (same function names).
7. **Access control:** `middleware/auth.js → assertEnterpriseAccess` allows every signed-in user today (Litelo team only). When clients get logins, check `auth.member` / `auth.member_org_access` there — every route goes through it.

## 5. Put it into the Litelo frontend

1. Copy `frontend/src/services/mis-api.js` and `frontend/src/components/mis/`.
2. Add the page: `<Route path="/platform/report" element={<MISReport />} />` and a sidebar link "Report".
3. If the API is on another host, set `REACT_APP_MIS_API_URL=https://api.litelo.ai/api/mis`. Downloads use a plain link, so the API must accept the session **cookie** (a bearer token in JS will not be sent with a file download).

---

## 6. API reference (`/api/mis`)

| Method | Path | What it does |
|---|---|---|
| GET | `/config` | Signed-in user, workflows, filter operators |
| GET | `/enterprises` | Active organisations |
| GET | `/catalog/:workflow` | Columns a user can pick |
| GET | `/templates?enterpriseId&workflow&status` | List templates |
| GET/PUT/DELETE | `/templates/:id` | Read / update / delete (delete reports how many schedules stopped) |
| POST | `/templates` | Create |
| POST | `/templates/:id/duplicate` | Copy as Draft |
| POST | `/reports/preview` | `{templateId, dateFrom, dateTo}` → first 50 rows + total count |
| POST | `/reports/export` | `{…, format}` → queued History item (202) |
| GET | `/history?enterpriseId&search&limit&offset` | `{items, total}` |
| GET | `/history/:id` | One item — poll this for export progress |
| GET | `/history/:id/file` | The file (410 if older than retention) |
| GET | `/schedules?templateId` | Schedules of a template |
| POST | `/schedules` | Create + send first email now |
| PUT/DELETE | `/schedules/:id` | Edit / cancel |

Errors are always `{ error, errors[] }` — `errors` holds user-facing messages.

---

## 7. Adding or changing a column

1. Edit `backend/config/column-catalog.js` — add a `one(...)` or `many(...)` line in the right group (the file header explains both).
2. If it reads a new per-case table, add an index on that table's `case_id` (see Part 2 of the migration).
3. `npm test`, then `npm run docs:columns` to refresh `LITELO_COLUMNS.md`.

---

## 8. Troubleshooting

| Symptom | Check |
|---|---|
| "Please sign in." (401) | Running standalone? Set `MIS_DEV_USER_ID` in `.env`. Inside Litelo: auth middleware must run before `/api/mis`. |
| Export stuck on "Waiting…" | Is a server running with `MIS_RUN_WORKERS=true`? Logs show `[export] worker started`. |
| "The report took too long" | Add the index for that template's date basis (migration Part 2) or raise `MIS_EXPORT_TIMEOUT_MINUTES`. |
| A column is always empty | Check the assumptions table at the top of `LITELO_COLUMNS.md` against the database. |
| Emails not arriving | `SMTP_HOST` set? Logs show `[email] SMTP not configured` when it is not. |
| Wrong day in reports | All dates are India time on purpose (`withReportSession` sets `Asia/Kolkata`). |
