# MIS Report — Code Understanding Guide

**For:** product managers and anyone who wants to understand how the MIS Report module works, without being a developer.
**Use it to:** follow the code, ask the right questions, and discuss changes with the SDE.

Each file is explained in the same way:
- **What it is** — one line.
- **When it runs** — what the user does that triggers it.
- **Walkthrough** — the code, block by block, with the important lines quoted and explained.
- **PM notes** — what this means for the product.
- **Ask your SDE** — questions worth discussing.

Code is quoted in `grey boxes`. You do not need to read every quoted line; the explanation under it is enough.

---

## Contents

1. [The big picture](#1-the-big-picture)
2. [Words you will hear](#2-words-you-will-hear)
3. [The documents in the folder](#3-the-documents-in-the-folder)
4. [The database tables](#4-the-database-tables--databasemigrationssql)
5. [Backend — file by file](#5-backend--file-by-file)
6. [Frontend — file by file](#6-frontend--file-by-file)
7. [Demo mode](#7-demo-mode)
8. [Tests](#8-tests)
9. [Four journeys traced through the code](#9-four-journeys-traced-through-the-code)
10. [Settings you can change without code](#10-settings-you-can-change-without-code)
11. [Known limits and open questions](#11-known-limits-and-open-questions)

---

## 1. The big picture

The module has three parts:

```
 ┌────────────────────┐        ┌──────────────────────────┐        ┌──────────────────┐
 │  FRONTEND (React)  │  HTTP  │  BACKEND (Node/Express)  │  SQL   │  DATABASE        │
 │  what users see    │ ─────▶ │  rules, SQL, files,      │ ─────▶ │  (Postgres,      │
 │  in the browser    │ ◀───── │  emails                  │ ◀───── │   sit_lwms)      │
 └────────────────────┘  JSON  └──────────────────────────┘  rows  └──────────────────┘
        frontend/                      backend/                        database/
```

- **Frontend** = the four screens: Report templates, Builder, Report download, History. It never touches the database; it only asks the backend.
- **Backend** = the brain. It checks every request, turns a saved template into SQL, reads the data, writes Excel/CSV files, and sends scheduled emails.
- **Database** = Litelo's existing Postgres. We read case data from the existing tables (`cms.cheque`, `cms.litigants`, …) and add **three new tables** of our own for templates, history and schedules.

### The single most important idea

A **template** is just a saved recipe: *which enterprise, which workflow, which date field, which columns, which filters*. When someone downloads a report, the backend turns that recipe into a database query **at that moment**, so the file always has the latest data.

### How a download works (the "big file" design)

Reports can have millions of rows. Building such a file takes minutes, which is longer than a web request is allowed to wait. So downloads work like ordering food:

1. You click **Download Excel** → the backend writes an "order slip" (a row in `report_history` with status `queued`) and replies immediately.
2. A **worker** in the backend picks up the slip, reads the data in batches of 5,000 rows, and writes them into the file on disk.
3. Your browser checks every 1.5 seconds: "Is it ready?" — and shows a progress bar.
4. When status becomes `done`, the browser downloads the file.

Because rows are written to disk as they arrive, memory use stays the same whether the report has 100 rows or 5 million.

---

## 2. Words you will hear

| Word | Plain meaning |
|---|---|
| **API / endpoint** | A URL the frontend calls to ask the backend for something, e.g. `GET /api/mis/templates`. |
| **GET / POST / PUT / DELETE** | Read / create / update / delete. |
| **JSON** | The text format data travels in between frontend and backend. |
| **Status code** | A number on every reply. 200 = OK, 201 = created, 202 = accepted (working on it), 400 = your input is wrong, 401 = not signed in, 403 = not allowed, 404 = not found, 410 = gone, 500 = server bug. |
| **SQL / query** | The language used to ask the database for data. |
| **Table / column / row** | Like an Excel sheet / column heading / line. |
| **Schema** | A folder of tables in the database (`cms`, `auth`, `digiserve`…). |
| **Join** | Combining two tables on a shared value, e.g. case + its borrower. |
| **Sub-query** | A small query inside a bigger one, e.g. "the latest SMS status for this case". |
| **Index** | Like a book's index — lets the database find rows without reading the whole table. Critical for speed. |
| **Parameter ($1, $2)** | A placeholder in SQL that is filled with user input safely. This is what stops SQL injection. |
| **SQL injection** | An attack where someone types SQL into a form field to break or steal data. |
| **Cursor** | A way to read query results a batch at a time instead of all at once. |
| **Stream** | Writing/reading data piece by piece instead of holding it all in memory. |
| **Queue / job / worker** | A to-do list of work, one item on it, and the background process that does it. |
| **Environment variable / `.env`** | Settings kept outside the code (DB password, port…). Different per server. |
| **Middleware** | Code that runs on every request before the main handler, e.g. "is the user signed in?". |
| **Service** | A backend file that owns one area of business logic, e.g. templates. |
| **Route** | The backend code that answers one endpoint. |
| **React component** | One piece of screen, written as a function that returns HTML-like code (JSX). |
| **State** | Data a screen remembers while you use it (e.g. which date preset is picked). |
| **Props** | Data a parent component passes to a child component. |
| **Hook** | A React helper starting with `use…` (`useState`, `useEffect`). |
| **`useEffect`** | "Run this code when the screen opens, or when X changes" — usually to load data. |
| **Proxy** | In development, the frontend server forwarding `/api` calls to the backend. |
| **IST** | Indian Standard Time, UTC+05:30. All business dates in this module use it. |

---

## 3. The documents in the folder

| File | What it is | Who maintains it |
|---|---|---|
| `MIS Report.md` | The product spec: goals, screens, user stories (US-1.1 … US-4.4), open questions. | PM |
| `litelo-reports-v2.html` | The clickable prototype. The React screens copy its look exactly. | PM / design |
| `LITELO_CONTEXT.md` | Description of Litelo's existing database tables and admin UI. Source for column mapping. | Shared |
| `LITELO_COLUMNS.md` | **Every report column** with its database source, as a checklist to verify on SIT. **Generated by code — do not edit by hand.** Run `npm run docs:columns` in `backend` to refresh it. | Generated |
| `INTEGRATION_GUIDE.md` | How to run locally and plug the module into the Litelo backend and frontend. | SDE |
| `DEPLOYMENT_CHECKLIST.md` | Everything to do before go-live, in order. | PM + SDE |
| `MIS_Implementation_Strategy.md` | Early planning notes. **Partly outdated** (e.g. table designs changed). Keep for history only. | — |
| `CODE_UNDERSTANDING.md` | This file. | — |
| `.gitignore` | Tells Git which files never to upload: `node_modules`, `.env` (passwords), generated exports and builds. | SDE |

---

## 4. The database tables — `database/migrations.sql`

**What it is:** the SQL script that creates the module's three tables and adds speed indexes to existing tables.
**When it runs:** once, by hand, per environment (SIT, then production).

### Table 1 — `cms.report_templates` (one row = one saved report)

```sql
CREATE TABLE IF NOT EXISTS cms.report_templates (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text NOT NULL,
    description   text,
    enterprise_id uuid NOT NULL,
    workflow      text NOT NULL,             -- 'section138' | 'section25' | 'sarfaesi'
    date_basis    text NOT NULL,             -- which date the range is matched on
    status        text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Active', 'Draft')),
    columns       jsonb NOT NULL DEFAULT '[]',
    filters       jsonb NOT NULL DEFAULT '[]',
    created_by, updated_by, created_at, updated_at ...
```

| Column | Meaning |
|---|---|
| `id` | Unique id, made automatically (`gen_random_uuid()`). |
| `name`, `description` | What the user typed in Step 1. |
| `enterprise_id` | Which client (points to `auth.organization`). |
| `workflow` | Section 138 / 25 / SARFAESI. |
| `date_basis` | The column key from Step 2, e.g. `notice_date`. |
| `status` | `Active` or `Draft`. `CHECK` means the database refuses any other value. |
| `columns` | Step 3, stored as a list: `[{"key":"borrower_name","label":"Borrower","mv":"latest"}]`. `mv` = what a repeating column shows (latest / first / all / count). |
| `filters` | Step 4: `[{"key":"case_status","op":"is","value":"Open"}]`. |
| `created_by` … `updated_at` | Audit: who and when. |

```sql
CREATE UNIQUE INDEX ... ON cms.report_templates (enterprise_id, lower(name));
```
**Rule from the spec (US-2.1):** a name must be unique *within an enterprise*, ignoring capital letters. The database itself enforces this, so even two people saving at the same second cannot create duplicates.

### Table 2 — `cms.report_schedules` (one row = one repeating email)

| Column | Meaning |
|---|---|
| `template_id` | Which report. `ON DELETE CASCADE` = if the template is deleted, its schedules are deleted too (spec US-1.4). |
| `frequency` | daily / weekly / monthly. |
| `send_time` | e.g. 09:00, India time. |
| `end_date` | Keep sending until. |
| `recipients` | List of email addresses. |
| `format` | xlsx or csv. |
| `range_days` | **How many days each email covers.** If the user ran 1–7 Oct (7 days), every email covers the 7 days ending on its send date — spec US-3.4. |
| `next_run_at` | The exact moment of the next send. The scheduler looks only at this. |
| `last_run_at` | When it last sent. |

### Table 3 — `cms.report_history` (one row = one file ever built)

This table has **two jobs**: it is the History screen (audit trail) *and* the to-do list for building files.

| Column | Meaning |
|---|---|
| `template_id` | Which template. `ON DELETE SET NULL` = if the template is deleted, history stays but loses the link (spec: past downloads stay in History). |
| `schedule_id` | Set when the file came from an email schedule. |
| `template_name`, `enterprise_name` | **Copies** of the names at that time, so History still reads correctly after a rename or delete. |
| `date_from`, `date_to` | The range the file covers. |
| `format`, `delivery` | xlsx/csv; Download or Email. |
| `recipients` | For emails. |
| `status` | `queued` → `running` → `done` or `failed`. |
| `row_count` | Rows written so far (grows while running → progress bar). |
| `file_name` | What the user downloads, e.g. `Court_pipeline_ABCBank_20260901.xlsx` (spec US-3.3: report + client + end date). |
| `file_key` | Where the file sits on disk. Becomes empty after 90 days when the file is deleted. |
| `file_size`, `error` | Size in bytes; failure reason in plain English. |
| `generated_by`, `generated_at`, `started_at`, `completed_at`, `updated_at` | Audit. `updated_at` is also a **heartbeat**: while a file builds it is updated every few seconds; if it stops, the job is assumed dead. |

### Part 2 — indexes on existing tables

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS mis_cheque_ent_notice ON cms.cheque (enterprise_id, notice_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS mis_comm_request_case_mode ON digiserve.communication_request (case_id, communication_mode);
...
```
Every report asks "cases of enterprise X where date Y is in range" and, per case, "its borrower / latest SMS / hearings". Without these indexes, the database reads millions of rows for each report. `CONCURRENTLY` builds the index without locking the table for the rest of Litelo.

**PM notes**
- Part 2 changes tables owned by other teams. Agree it with them before running on production.
- One index is needed per date field clients use as "date range applies to". Four common ones are included.

**Ask your SDE**
- Do any of these indexes already exist under another name?
- How long will Part 2 take on production table sizes, and when should we run it?

---

## 5. Backend — file by file

### Folder layout

```
backend/
├── server.js            start-up: checks setup, starts the API and the workers
├── package.json         list of libraries + commands (npm start, npm test, npm run demo)
├── .env.example         template for settings
├── config/              WHAT the module offers (workflows, columns, filter conditions, settings)
├── db/                  HOW we talk to Postgres
├── middleware/          checks that run on every request (login, errors)
├── utils/               shared helpers (SQL builder, validation, dates, errors)
├── services/            business logic, one file per area
├── jobs/                background workers (build files, scheduled emails)
├── routes/              the API endpoints
├── scripts/             one-off tools (generates LITELO_COLUMNS.md)
├── demo/                demo server with fake data (no database)
└── tests/               automatic checks
```

**Rule of thumb for finding code:** *"What can a user pick?"* → `config/`. *"What happens when they click?"* → `routes/` then `services/`. *"What runs in the background?"* → `jobs/`.

---

### 5.1 `backend/package.json`

**What it is:** the backend's ID card — name, commands, and the libraries it uses.

```json
"scripts": {
  "start": "node server.js",                 // real server (needs database)
  "demo": "node demo/demo-server.js",        // fake-data server (no database)
  "test": "node --test tests/*.test.js",     // run automatic tests
  "docs:columns": "node scripts/generate-column-docs.js"   // refresh LITELO_COLUMNS.md
},
"dependencies": {
  "cors": ...,        // lets a browser on another address call the API (local dev)
  "dotenv": ...,      // reads the .env settings file
  "exceljs": ...,     // writes .xlsx files
  "express": ...,     // the web server framework
  "nodemailer": ...,  // sends emails over SMTP
  "pg": ...,          // talks to Postgres
  "pg-cursor": ...    // reads big query results in batches
}
```

---

### 5.2 `backend/.env.example`

**What it is:** a template of every setting, with comments. Copy it to `.env` and fill it in. `.env` holds passwords, so it is never uploaded to Git. All settings are explained in [section 10](#10-settings-you-can-change-without-code).

---

### 5.3 `backend/server.js` — start-up

**What it is:** the file that starts everything.
**When it runs:** `npm start`.

```js
async function checkSetup() {
  if (!fs.existsSync(path.join(__dirname, '.env'))) problems.push('No backend/.env file...');
  if (!env.db.user) problems.push('DB_USER is empty in .env.');
  if (!env.devUser) console.warn('MIS_DEV_USER_ID is empty, so every request will get "Please sign in" (401)...');
  ...
  SELECT to_regclass('cms.report_templates') ...   // do our tables exist?
  SELECT 1 FROM auth.account WHERE id = $1          // is the dev user real?
  ...
  catch (err) { problems.push(`Cannot connect to Postgres at ...`) }
}
```
Before starting, it checks: is there a `.env`? Is the database reachable? Were the tables created? Is the test user real? If anything is wrong it prints **one clear list** and stops, instead of failing on every click later.

```js
app.use(cors());                          // allow the browser to call us
app.use(express.json({ limit: '1mb' }));  // read JSON request bodies, max 1 MB
app.get('/health', ...)                   // "am I alive?" check for monitoring
app.use('/api/mis', misRoutes);           // all MIS endpoints live under /api/mis
app.use(errorHandler);                    // turns any error into a clean JSON reply
```

```js
if (env.runWorkers) {
  startExportWorker();   // background file builder
  startScheduler();      // background email sender + cleanup
}
```
With several servers you might want only some of them doing background work; `MIS_RUN_WORKERS=false` turns it off.

```js
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error('Port 5000 is already in use — another backend is probably running...');
```
Friendly message when you start it twice.

**PM notes:** In the real Litelo backend this file is *not* used — only two lines from it are copied (mount routes, start workers). See `INTEGRATION_GUIDE.md` §4.

---

### 5.4 `backend/config/env.js` — settings reader

**What it is:** reads `.env` once and gives every other file one tidy settings object.

```js
function readInt(name, fallback) { ... }     // read a number setting, or use the default
module.exports = {
  port: readInt('PORT', 5000),
  db: { host, port, database, user, password, ssl, max },  // max = connections kept open
  exports: { dir, batchSize: 5000, maxConcurrent: 2, queryTimeoutMinutes: 60, retentionDays: 90 },
  preview: { rowLimit: 50, queryTimeoutSeconds: 60 },
  runWorkers, devUser, email: { from, maxAttachmentMb: 20, smtp },
};
```
**Why:** settings are read in exactly one place, each with a sensible default. To change a limit, you change `.env`, not code.

---

### 5.5 `backend/config/workflows.js` — the three workflows

```js
const WORKFLOWS = {
  section138: { label: 'Section 138', baseTable: 'cms.cheque', caseType: 'cheque' },
  section25:  { label: 'Section 25',  baseTable: null,         caseType: 'eft' },
  sarfaesi:   { label: 'SARFAESI',    baseTable: null,         caseType: 'sarfaesi' },
};
```
- `baseTable` = the table with **one row per case**. Every report query starts from it.
- `caseType` = the value other tables use to say "this row belongs to a cheque case".
- `baseTable: null` = the workflow shows in the UI but says "not available yet".

```js
function listWorkflows() { ... available: Boolean(wf.baseTable) }
```
Sent to the frontend so it knows which buttons to show and which are empty.

**PM notes:** turning on Section 25 or SARFAESI = fill in its base table here + add its columns in `column-catalog.js`. That is a decision you need from the data/platform team.

---

### 5.6 `backend/config/filter-operators.js` — filter conditions

```js
const OPERATORS = {
  text:    is, is not, contains, is empty, is not empty
  enum:    is any of, is none of, is empty, is not empty      // pick lists
  number:  more than, at least, less than, at most, equals    // also used for amounts
  date:    is empty, is not empty, before, after, in the last N days, in the next N days
  boolean: is Yes, is No
};
const NO_VALUE_OPERATORS = ['empty', 'notempty', 'yes', 'no'];   // these need no value box
```
This is the list behind the "condition" dropdown in Builder Step 4 (spec US-2.6). The frontend downloads this list from the backend, so the UI can never offer a condition the backend cannot handle.

---

### 5.7 `backend/config/column-catalog.js` — every column (the most important config file)

**What it is:** the full list of columns a user can pick, and **the exact SQL** that produces each one.
**When it runs:** loaded once at start-up; used by the Builder (column list) and by every report.

#### How every report query looks

```
SELECT  <one expression per chosen column>
FROM    cms.cheque c                 ← one row per case; nicknamed "c"
<joins> ...                          ← only the extra tables the chosen columns need
WHERE   c.enterprise_id = <client> AND <date basis between From and To> AND <fixed filters>
```

#### Two kinds of column

```js
const one  = (key, label, type, sql, extra) => ...   // ONE value per case
const many = (key, label, type, source, extra) => ... // SEVERAL values per case
```

- **`one(...)`** — e.g. borrower name, cheque number. `sql` says where it comes from.
  ```js
  one('cheque_no', 'Cheque number', 'text', 'c.cheque_number')
  ```
  Key `cheque_no`, heading "Cheque number", type text, value = column `cheque_number` of the case table.

- **`many(...)`** — data that repeats per case: SMS messages, hearings, replies, milestones. These show the "repeats" tag in the Builder, and the user picks **latest / first / all joined / count** (spec US-2.5).
  ```js
  many('sms_status', 'SMS status', 'text', { ...communicationsByMode('sms'), value: 'x.status' })
  ```
  "From `digiserve.communication_request`, the rows of this case where mode = sms, take `status`."

**Why repeating data is not joined:** if a case has 5 SMS and we join, that case becomes 5 rows in the Excel. Instead, each repeating column is a small sub-query per case, so **one case is always exactly one row**.

#### Lookups — extra tables joined only when needed

```js
respondent: `LEFT JOIN LATERAL (
    SELECT l.* FROM cms.litigants l
    WHERE l.case_id = c.id AND l.case_type = 'cheque' AND l.is_primary_respondent
    ORDER BY l.id LIMIT 1
  ) respondent ON true`,
```
"For each case, find its primary respondent (the borrower). Take at most one." Any Borrower column (`borrower_name`, `borrower_email`…) says `needs: ['respondent']`, so this join is added only if such a column is chosen.

| Lookup | Brings in |
|---|---|
| `respondent` | Borrower row from `cms.litigants` |
| `respondentAddress` | Borrower's latest address (needs `respondent` first) |
| `execution` | Workflow stage info from `workflow.executions` |
| `ecourt` | eCourts data matched on CNR |

#### Groups of columns

`borrowerGroup`, `workflowGroup`, `courtGroup`, `proceedingsGroup`, `communicationGroup`, `documentsGroup` are written once as functions so Section 25 and SARFAESI can reuse them later. `section138Groups()` lists all groups for Section 138 in the order the Builder shows them: Case and batch, Borrower, Claimant, Loan, Cheque, Dishonour, Demand notice, Complaint filing, Case tracking, Workflow, Court (eCourts), Proceedings, Communication and replies, Drafts and documents, Calculated timelines.

#### Calculated columns

```js
one('d_memo_notice', 'Days: return memo to notice', 'number',
    '(c.notice_date::date - c.return_memo_date::date)', { calculated: true })
```
Computed on the fly; shows the "calc" tag. `::date` = "treat as a date".

```js
one('notice_breach', 'Notice sent after 30-day limit', 'boolean',
    '(c.notice_date::date > c.return_memo_date::date + 30)')
```
Yes/No: was the notice later than 30 days after the return memo? (Section 138 legal limit.)

```js
one('ageing', 'Ageing bucket', 'enum', `CASE WHEN case_age <= 30 THEN '0–30 days' ... ELSE 'Over 1 year' END`)
```
Puts each case in an age group based on days since the case was created.

#### Start-up safety check

```js
if (fieldsByKey[field.key]) throw new Error(`Duplicate column key ...`);
if (!lookups[name]) throw new Error(`Column needs unknown lookup ...`);
```
A typo in this file stops the server at start-up, instead of breaking a client's report later.

#### What the browser receives

```js
function toPublicField(field) { return { key, label, type, group, description, options, repeating, calculated, canBeDateBasis }; }
```
**No SQL is sent to the browser** — only what the Builder needs to show.

```js
function canBeDateBasis(field) { return (type === 'date' || 'datetime') && !field.repeating; }
```
Only single dates can be the "Date range applies to" field. "Hearing date" repeats, so it cannot (which hearing would it mean?).

**PM notes**
- Adding a column = adding one line here. Then run `npm run docs:columns`.
- Several values in this file are **assumptions** (e.g. SMS stored as `'sms'`). They are listed at the top of `LITELO_COLUMNS.md` to verify on SIT.
- Column **types** decide which filter conditions appear. Status / stage are "text" today because their possible values are unknown; once known, making them "enum" gives users a pick list.

**Ask your SDE**
- Is `cms.cheque.case_number` the ID clients recognise, or is it `ref_number` / `agreement_number`?
- Where do Batch ID, cheque amount and notice delivery status live? (Listed as missing in `LITELO_COLUMNS.md`.)

---

### 5.8 `backend/db/pool.js` — talking to Postgres

**What it is:** the database connection and three helpers.

```js
const pool = new Pool(env.db);
```
A **pool** keeps up to 10 open connections and lends them out, which is much faster than connecting for every click.

```js
const reportTypes = { getTypeParser: (oid) => (oid === DATE_OID ? (value) => value : ...) };
function query(text, values, client = pool) { return client.query({ text, values, types: reportTypes }); }
```
By default, the database library turns a date like `2026-10-01` into a timestamp at server-local midnight, which on a UTC server shows as **30 Sep**. This keeps dates as plain text `'2026-10-01'`. Every MIS query uses `query(...)`.

```js
async function withReportSession(fn, { timeoutMs }) {
  await client.query(`SET TIME ZONE 'Asia/Kolkata'; SET statement_timeout = ...`);
  return await fn(client);
  ... finally RESET both, release the connection
}
```
Every report runs on a connection set to **India time** (so "today" and "1 Oct" mean Indian dates), with a **time limit** so a runaway query cannot block the database. Both settings are undone before the connection goes back to the pool.

```js
async function withTransaction(fn) { BEGIN ... COMMIT, or ROLLBACK on error }
```
Do several changes as one: all succeed or none do. Used when deleting a template (delete schedules + template together).

---

### 5.9 `backend/middleware/auth.js` — who is calling?

```js
function requireUser(req, res, next) {
  if (!req.user && env.devUser) req.user = env.devUser;     // local dev: pretend to be this user
  if (!req.user || !req.user.id) return next(new HttpError(401, 'Please sign in. ...'));
  next();
}
```
In Litelo, the platform's login system already puts the user on `req.user`. Running on its own, `MIS_DEV_USER_ID` stands in. No user → 401.

```js
function assertEnterpriseAccess(user, enterpriseId) {
  const allowed = Boolean(user && enterpriseId);
  if (!allowed) throw forbidden();
}
```
**Today: every signed-in user can see every enterprise** (fine if only the Litelo team uses it). Every route calls this one function, so when clients get logins, the rule is written once here.

**Ask your SDE:** how do we know which organisations a user belongs to (`auth.member`, `auth.member_org_access`)? Can a user belong to several?

---

### 5.10 `backend/middleware/error-handler.js` — clean errors

```js
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
```
Wraps each route so any error is caught automatically (no repeated try/catch).

```js
function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, errors: err.errors });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request body is not valid JSON.' });
  console.error(...);  res.status(500).json({ error: 'Something went wrong. Please try again.' });
}
```
Expected problems (bad input, not found) → clear message to the user. Unexpected bugs → logged for developers; the user sees a generic message, never technical details.

---

### 5.11 `backend/utils/http-error.js`

```js
class HttpError extends Error { constructor(status, message, errors = []) ... }
const badRequest = (message, errors) => new HttpError(400, ...);
const forbidden  = ... 403;  const notFound = ... 404;  const gone = ... 410;
```
Short names for "this is the user's problem, tell them". `errors` is the bullet list shown under "Fix these before saving".

---

### 5.12 `backend/utils/dates.js` — India-time date maths

```js
const IST_OFFSET_MS = 330 * 60 * 1000;   // +5 hours 30 minutes
```
| Function | What it does | Example |
|---|---|---|
| `isIsoDate(v)` | Is it a real date in `YYYY-MM-DD`? | `2026-02-30` → no |
| `isTime(v)` | Is it `HH:MM`? | `09:00` → yes |
| `todayIst()` | Today's date in India | 01:30 IST on 1 Oct → `2026-10-01` |
| `addDays(d, n)` | Move a date | `2026-03-01`, −1 → `2026-02-28` |
| `daysInRange(a, b)` | Days counting both ends | 1–7 Oct → 7 |
| `istDateTime(d, t)` | The exact moment "09:00 on 5 Oct in India" | → 03:30 UTC |
| `addPeriod(m, freq)` | One day / week / month later; month keeps the day (31 Jan → 28 Feb) | |
| `nextRunAfter(from, freq, now)` | Next send after now; **skips missed sends** if the server was down instead of sending a burst | |

---

### 5.13 `backend/utils/validators.js` — checking user input

**What it is:** every rule about what users may save, with the exact messages they see.

```js
function validateTemplate(input) {
  if (!value.name) errors.push('Give the report a name.');
  if (!isUuid(value.enterpriseId)) errors.push('Choose an enterprise.');
  if (!workflow || !workflow.baseTable) { errors.push(...); return }   // columns can only be checked against a workflow
  if (!dateField || !canBeDateBasis(dateField)) errors.push('Choose the date field the date range applies to.');
  value.columns = cleanColumns(...);   // 'Add at least one column.'
  value.filters = cleanFilters(...);   // 'Filter 1 (Case status) needs a value.'
}
```
Collects **all** problems at once (spec US-2.8: "a list of fixes is shown").

```js
function cleanColumns(...) {
  if (seen.has(field.key)) continue;              // same column ticked twice → keep one
  const label = text(column.label) || field.label; // empty heading → use the default name
  mv: field.repeating && REPEAT_MODES.includes(column.mv) ? column.mv : 'latest'
}
```

```js
function cleanFilter(...) {
  const allowed = operatorsForType(field.type)...   // "contains" on an amount → rejected
  if (NO_VALUE_OPERATORS.includes(op)) return { key, op, value: null };
  ... each condition type checks its own value: list, number of days, date, number, text
}
```

```js
function validateDateRange({ dateFrom, dateTo }) → 'Choose both a start and an end date.' / 'The start date is after the end date.'
function validateSchedule(input) → recipients cleaned (lower-case, no duplicates), each checked:
  '"nope" is not a valid email address.'   'The end date is in the past.'
```

```js
const LIMITS = { name: 120, description: 500, label: 100, columns: 200, filters: 30, recipients: 50, maxRangeDays: 3660 };
```
Upper limits to stop abuse or accidents.

**PM notes:** all user-facing wording for validation lives here. Change the text here and it changes everywhere.

---

### 5.14 `backend/utils/query-builder.js` — template → SQL (the engine)

**What it is:** takes a saved template and a date range and writes the SQL.
**When it runs:** every preview and every file.

```js
function buildReportQuery(template, { dateFrom, dateTo }) {
  const params = [];
  const addParam = (value, cast) => { params.push(value); return `$${params.length}::${cast}`; };
```
**The safety rule:** anything a user typed (dates, filter values) never goes into the SQL text. It goes into `params` and the SQL only contains `$1`, `$2`… The database fills them in safely. This is what blocks SQL injection.

```js
  const columns = template.columns.map((column, index) => {
    const field = fieldFor(column.key);
    field.needs.forEach((name) => selectLookups.add(name));   // remember which joins are needed
    const { sql, type } = selectExpression(field, column.mv);
    return { alias: `c${index}`, label: column.label || field.label, type, sql };
  });
```
Each chosen column becomes one SQL expression, named `c0, c1, c2…`. The file writer later puts the user's headings on top by position. (The old code named columns by their heading and then looked them up by key, which left every cell empty.)

```js
  const conditions = [
    `c.enterprise_id = $1::uuid`,
    `${dateExpr} >= $2::date`,
    `${dateExpr} < $3::date + 1`,    // up to the end of the "To" day
  ];
  for (const filter of template.filters) conditions.push(buildFilterCondition(...));
```
The WHERE part: this client + date range + each fixed filter, joined with AND (spec: "a case must match all of them").

```js
  const sql = [SELECT ..., FROM cms.cheque c, joins, WHERE ..., `ORDER BY ${dateExpr} DESC`].join('\n');
  const countSql = ['SELECT count(*)', FROM, joins needed by WHERE only, WHERE].join('\n');
```
Two queries: the rows (newest first, spec Step 4 hint) and the total count. The count only joins what the filters need, so it stays fast. **The count uses the same filters**, so "Showing 50 of 12,84,512" is correct.

```js
function repeatingSubquery(source, mv) {
  count  → (SELECT count(*) FROM ... WHERE ...)
  all    → (SELECT string_agg(DISTINCT value, '; ') ...)          // "Delivered; Failed"
  first  → (SELECT value ... ORDER BY date ASC  LIMIT 1)
  latest → (SELECT value ... ORDER BY date DESC LIMIT 1)
}
```
The four "repeats" options from the Builder, as SQL.

```js
function formatForOutput(expr, type) {
  date → (expr)::date              → '2026-10-01'
  datetime → to_char(expr, 'YYYY-MM-DD HH24:MI')
  text/enum → (expr)::text
}
```
Every value comes back in a predictable shape so the file writers can make real Excel dates and numbers.

```js
function buildFilterCondition(expr, { op, value }, addParam) {
  case 'is':       expr::text = $4
  case 'isnot':    expr::text IS DISTINCT FROM $4    // also keeps empty values, unlike "<>"
  case 'contains': expr::text ILIKE '%value%'        // case-insensitive
  case 'in':       expr::text = ANY($4::text[])
  case 'gt' ...:   expr > $4::numeric
  case 'before':   expr < $4::date
  case 'after':    expr >= $4::date + 1               // strictly after that day
  case 'lastn':    expr >= CURRENT_DATE - N + 1 AND expr < CURRENT_DATE + 1
  case 'yes':      expr IS TRUE
  ...
}
```
One line of SQL per filter condition.

```js
function escapeLike(text) { ... }   // a user searching "50%" means the characters 50%, not a wildcard
function joinClauses(lookups, names) { ... }   // adds joins in the right order (respondent before its address)
```

**Ask your SDE:** for the biggest client, what does `EXPLAIN ANALYZE` say about this query? Are the indexes used?

---

### 5.15 `backend/services/template.service.js` — saving templates

| Function | Spec | What it does |
|---|---|---|
| `listTemplates({enterpriseId, workflow, status})` | US-1.1 | Templates for a client (+ workflow / Active), newest change first, with the email of who last edited. |
| `getTemplate(id)` | | One template, or "This report no longer exists." |
| `createTemplate(input, userId)` | US-2.x | Validate → insert. |
| `updateTemplate(id, input, userId)` | US-2.8 | Validate → update. Applies from the next run; old files never change. |
| `duplicateTemplate(id, userId)` | US-1.3 | Copy named "X (copy)" (or "(copy 2)" if taken), always **Draft**. |
| `deleteTemplate(id)` | US-1.4 | Deletes schedules + template together; returns how many schedules stopped so the UI can say so. History stays. |

```js
function toTemplate(row) { return { id, name, enterpriseId: row.enterprise_id, ... } }
```
Database names use `snake_case`; the frontend uses `camelCase`. This converts in one place.

```js
async function saveOrExplainDuplicate(runQuery) {
  catch (err) { if (err.code === '23505') throw badRequest(..., ['This enterprise already has a report with that name.']); }
}
```
`23505` = Postgres's code for "unique rule broken". Turned into a friendly message.

---

### 5.16 `backend/services/enterprise.service.js` and `account.service.js`

```js
SELECT id, name FROM auth.organization WHERE is_active ORDER BY name   // Enterprise dropdown
SELECT name FROM auth.organization WHERE id = $1                       // name for file names and emails
SELECT email, first_name, last_name FROM auth.account WHERE id = $1    // name + initials in the header
```

---

### 5.17 `backend/services/report.service.js` — reading report data

```js
async function previewReport(template, range) {
  rows  = sql + LIMIT 50          // first 50 rows only
  count = countSql                // total
  return { columns, rows, totalCount };
}
```
The on-screen preview (spec US-3.2). Runs in an India-time session with a 60-second limit.

```js
function prepareExport(template, range) {
  const streamRows = (onBatch) => withReportSession(async (client) => {
    const cursor = client.query(new Cursor(sql, params, ...));
    for (;;) {
      const rows = await cursor.read(5000);   // next 5,000 rows
      if (!rows.length) break;
      await onBatch(rows, rowCount);           // write them before reading more
    }
  });
  return { columns, streamRows };
}
```
**The heart of big downloads.** A cursor hands out 5,000 rows at a time; the next batch is only read after the previous one is written. If the disk is slow, reading slows down too, so memory never fills up.

---

### 5.18 `backend/services/report-writers.js` — writing Excel and CSV

Both writers work the same way: `writeRows(batch)` many times, then `finish()`.

#### Turning values into cells

```js
function toExcelValue(value, type) {
  date/datetime → real Excel date (sortable, filterable)
  number/amount → real number
  boolean       → 'Yes' / 'No'
  text          → text, cut at 32,767 characters (Excel's cell limit)
}
const NUMBER_FORMAT = { date: 'dd-mmm-yyyy', amount: '#,##0.00', ... };
```

```js
function toCsvField(value, type) {
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;   // block "formula injection"
  quote values that contain , " or a new line
}
```
**Security:** a text cell starting with `=` would run as a formula when a client opens the CSV in Excel. Adding `'` in front makes Excel show it as plain text. Numbers like `-500` are not touched.

#### CSV writer

```js
this.stream.write(`﻿${header}\r\n`);
```
`﻿` (a "byte-order mark") tells Excel the file is UTF-8, so Hindi or Marathi names show correctly instead of garbage.

```js
if (!this.stream.write(chunk)) await once(this.stream, 'drain');
```
"If the disk is busy, wait until it catches up." Without this, a 3-million-row CSV would pile up in memory.

#### Excel writer

```js
new ExcelJS.stream.xlsx.WorkbookWriter({ filename, useStyles: true, useSharedStrings: false })
```
A **streaming** Excel writer: rows go to disk as they are added. "Shared strings" is off because it keeps every distinct text in memory.

```js
const EXCEL_MAX_ROWS_PER_SHEET = 1048575;
if (this.rowsInSheet >= EXCEL_MAX_ROWS_PER_SHEET) this.addSheet();   // "Report", "Report (2)", ...
```
Excel cannot hold more than 1,048,576 rows on one sheet. Bigger reports continue on the next sheet automatically.

```js
views: [{ state: 'frozen', ySplit: 1 }]   // header row stays visible while scrolling
this.sheet.autoFilter = ...                // filter arrows on the header
header.font = { bold: true }; header.fill = grey
```

```js
async waitForZip() {
  if (needsDrain) await once(zipInput, 'drain');
}
```
An `.xlsx` file is actually a zip. The Excel library adds rows faster than it can compress them, and on a 1.2-million-row test memory reached 925 MB. Waiting for the compressor after each batch brought it down to 259 MB. This touches the library's internals (commented in the code), so it must be re-tested if the library is upgraded.

---

### 5.19 `backend/services/file-storage.js` — where files live

```js
fileKeyFor(historyId, format) → "<id>.xlsx"
pathFor(fileKey)    → full path inside MIS_EXPORT_DIR (path.basename blocks "../" tricks)
fileExists, fileSize, removeFile
```
Files are saved under their history id; users download them under the friendly name. **To move to S3, only this file changes.**

---

### 5.20 `backend/services/history.service.js` — History + the job queue

```js
function downloadFileName(templateName, enterpriseName, dateTo, format)
// "Notice dispatch tracker", "ABC Bank", "2026-09-15" → "Notice_dispatch_tracker_ABCBank_20260915.xlsx"
```

```js
async function queueExport({...})  → INSERT a row with status 'queued'
async function listHistory({ enterpriseId, search, limit, offset }) → { items, total }
   // search matches report name, file name, or who generated it (spec US-4.4); newest first (US-4.1)
```

```js
async function claimNextJob() {
  UPDATE cms.report_history SET status = 'running'
  WHERE id = (SELECT id ... WHERE status = 'queued' ORDER BY generated_at FOR UPDATE SKIP LOCKED LIMIT 1)
}
```
"Give me the oldest waiting job and mark it mine." `FOR UPDATE SKIP LOCKED` means if two servers ask at the same moment, they get different jobs, never the same one.

```js
updateProgress(id, rowCount)   // also a heartbeat
markDone(id, {...})  markFailed(id, message)
failStaleJobs(15)              // running but silent for 15 minutes → server died → 'failed'
listExpiredFiles(90)  clearFile(id)   // 90-day cleanup; the row stays
```

---

### 5.21 `backend/services/schedule.service.js` — repeating emails

```js
async function createSchedule(input, user) {
  validate → template must be Active
  nextRunAt = nextRunAfter(today at send time, frequency)   // one period from now
  INSERT schedule with range_days = days in the range the user ran
  queueExport(... delivery: 'Email', same dates the user just looked at)   // first email NOW (US-3.4)
}
```

```js
async function updateSchedule(id, input, user) {
  // Same time and frequency → keep the planned next send. Changed → re-plan from today.
}
async function deleteSchedule(id)   // stops future emails; sent ones stay in History (US-3.5)
```

```js
async function claimDueSchedule() {
  in one transaction:
    SELECT ... WHERE next_run_at <= now() AND end_date >= today ... FOR UPDATE SKIP LOCKED LIMIT 1
    UPDATE next_run_at = next period
  if the template is missing or Draft → skip (log it)
  dateTo = today; dateFrom = today − (range_days − 1)
  queueExport(... 'Email' ...)
}
```
The schedule is moved forward **before** the email is built, so a crash cannot send it twice.

---

### 5.22 `backend/services/email.service.js` — sending the email

```js
const transport = env.email.smtp ? nodemailer.createTransport(env.email.smtp) : null;
```
No SMTP settings → no real emails; it only logs "would send…". Safe for development.

```js
const fileTooBig = Number(job.file_size) > env.email.maxAttachmentMb * 1024 * 1024;
subject = `${template} · ${enterprise} · ${period}`
html table: Report, Enterprise, Period, Rows, Format
fileTooBig ? 'The file is larger than 20 MB … Download it from Report → History' : 'The file is attached.'
```
Answers the spec's open question about big attachments with a default (20 MB) you can change.

```js
const escapeHtml = ...   // a report named "<script>" cannot break the email
```

---

### 5.23 `backend/jobs/export-worker.js` — builds files in the background

```js
async function runExport(job) {
  const template = await templateService.getTemplate(job.template_id);   // read fresh (US-2.8)
  const report = prepareExport(template, { dateFrom, dateTo });
  writer = createReportWriter(job.format, path, report.columns);
  const rowCount = await report.streamRows(async (rows, rowsSoFar) => {
    await writer.writeRows(rows);
    every 3 seconds: updateProgress(job.id, rowsSoFar)   // progress bar + heartbeat
  });
  await writer.finish();
  markDone(...)
  catch: delete the half-written file, markFailed(job.id, userMessage(err))
  if (job.delivery === 'Email') await deliverEmail(job.id);
}
```

```js
function userMessage(err) {
  if (err.status) return err.message;                 // our own message, e.g. "This report no longer exists."
  if (err.code === '57014') return 'The report took too long and was stopped. Try a shorter date range.';
  return 'The report could not be built. Please try again...';
}
```
`57014` = Postgres "cancelled because of the time limit".

```js
async function claimJobs() {
  while (running < env.exports.maxConcurrent) { claimNextJob → runExport (don't wait) }
}
setInterval(claimJobs, 2000);      // check the queue every 2 seconds
function nudgeExportWorker()       // called right after a job is queued, so it starts now
```
Each server builds at most `MIS_MAX_CONCURRENT_EXPORTS` (default 2) files at once; the rest wait in the queue. This protects the database from 20 people downloading at once.

```js
if (message !== lastClaimError || Date.now() - lastClaimErrorAt > 60000) console.error(...)
```
If the database is down, the error is printed once a minute, not every 2 seconds.

---

### 5.24 `backend/jobs/scheduler.js` — once a minute

```js
async function tick() {
  await sendDueSchedules();                 // up to 100 due emails per minute
  await historyService.failStaleJobs(15);   // stuck "Building…" → "Failed"
  await deleteExpiredFiles();               // files older than 90 days
}
setInterval(tick, 60 * 1000);
```
`busy` stops a slow minute from overlapping with the next one.

---

### 5.25 `backend/routes/report.routes.js` — the API

**What it is:** every URL the frontend can call. Each route is short: read input → check access → call a service → reply.

```js
router.use(requireUser);   // every MIS endpoint needs a signed-in user
```

```js
async function loadTemplate(req, id) {
  const template = await templateService.getTemplate(requireUuid(id, 'Report id'));
  assertEnterpriseAccess(req.user, template.enterpriseId);   // may this user see that client?
  return template;
}
```
Used by every template, report and schedule route, so access is always checked from the **stored** template, never from what the browser claims.

| Endpoint | Screen | What it does |
|---|---|---|
| `GET /config` | all | User, workflows, filter conditions |
| `GET /enterprises` | all | Enterprise dropdown |
| `GET /catalog/:workflow` | Builder | Column list |
| `GET /templates` | 1, 3 | List (optionally only Active) |
| `GET/POST/PUT/DELETE /templates…` | 1, 2 | Read / create / update / delete |
| `POST /templates/:id/duplicate` | 1 | Copy as Draft |
| `POST /reports/preview` | 3 | First 50 rows + total. Draft → refused. |
| `POST /reports/export` | 3 | Queue a file; replies **202** at once |
| `GET /history` | 4 | Paged list + search |
| `GET /history/:id` | 3, 4 | One item — polled for progress |
| `GET /history/:id/file` | 3, 4 | The file. Not ready → 404. Older than 90 days → **410** "use Run with latest data" (US-4.2) |
| `GET/POST/PUT/DELETE /schedules…` | 3 | Email schedules. POST sends the first email at once. |

```js
async function loadSchedule(req, id) {
  const schedule = await scheduleService.getSchedule(id);
  await loadTemplate(req, schedule.templateId);   // access via the schedule's own template
}
```
Closes a loophole where someone could edit another client's schedule by sending a different template id.

```js
res.download(pathFor(row.file_key), row.file_name);
```
Streams the file from disk to the browser, so file size does not matter.

---

### 5.26 `backend/scripts/generate-column-docs.js`

Reads `column-catalog.js` and writes `LITELO_COLUMNS.md`: one table per group with key, heading, type, SQL source and notes. Also holds two hand-written lists: **ASSUMPTIONS** (database facts to confirm, each with a check query) and **NOT_IN_DATABASE** (prototype columns without a source yet). Because the doc is generated, it can never disagree with the code.

---

## 6. Frontend — file by file

### Folder layout

```
frontend/
├── package.json             libraries + commands (npm start, npm run build)
├── public/index.html        the empty HTML page React fills in; loads the Inter font
└── src/
    ├── index.js             starts React
    ├── App.js               the sidebar + header shell (local only; Litelo has its own)
    ├── setupProxy.js        dev only: forwards /api to the backend
    ├── services/mis-api.js  every call to the backend
    └── components/mis/
        ├── MISReport.jsx          the Report page: tabs + shared state
        ├── TemplateList.jsx       Screen 1
        ├── ReportBuilder.jsx      Screen 2 (uses ColumnPicker + FilterEditor)
        ├── ColumnPicker.jsx       Builder Step 3
        ├── FilterEditor.jsx       Builder Step 4
        ├── ReportDownload.jsx     Screen 3
        ├── EmailScheduleModal.jsx "Email this report" window
        ├── ReportHistory.jsx      Screen 4
        ├── useExportJob.js        start file → poll → download
        ├── ui.jsx                 shared pieces: dialogs, toast, table, sentence
        ├── format.js              date / money / number formatting, date presets
        ├── sample-data.js         fake rows for the Builder preview
        └── mis-report.css         styles (copied from the prototype)
```

### How React screens work (30-second version)

```jsx
function Thing({ someProp }) {                 // a component receives "props" from its parent
  const [value, setValue] = useState('');      // "state": remembered while the screen is open
  useEffect(() => { load data }, [someProp]);  // run when the screen opens or someProp changes
  return <div className="panel">{value}</div>; // what to draw (JSX ≈ HTML)
}
```
When state changes, React redraws that part of the screen automatically.

---

### 6.1 `frontend/package.json`

```json
"dependencies": { "react", "react-dom", "react-scripts" },   // React + Create React App tooling
"eslintConfig": { "extends": ["react-app"] },               // turns on code-quality rules
"devDependencies": { "http-proxy-middleware" }              // used by setupProxy.js
```

### 6.2 `frontend/public/index.html` and `src/index.js`

`index.html` is an empty page with `<div id="root">` and the Inter font link. `index.js` draws `<App />` into that div. Nothing else.

### 6.3 `frontend/src/setupProxy.js` (development only)

```js
app.use('/api', createProxyMiddleware({ target: 'http://localhost:5000', changeOrigin: true }));
```
While developing, the screens run on port 3000 and the backend on 5000. This forwards every `/api` call to 5000. The simpler built-in proxy skipped download links (it treats them as page requests), so Excel/CSV downloads got the app's HTML instead of the file. Not used in production.

### 6.4 `frontend/src/App.js` — the shell

Draws the left sidebar (Dashboard, Cheque Bounce, EFT Dishonour, Case Tracker, **Report**) and the header (theme toggle, initials, name, email), copied from the prototype. Inside Litelo this file is **not** used — Litelo already has its own sidebar and header; only `<MISReport />` is placed on the page.

```js
const displayName = user.name || user.email.split('@')[0];
const initials = displayName.split(/[\s.]+/)...   // "Aleem Rayeen" → "AR"
function toggleTheme() { ... data-theme="dark" | "light" }
```

---

### 6.5 `frontend/src/services/mis-api.js` — every backend call

```js
const BASE_URL = process.env.REACT_APP_MIS_API_URL || '/api/mis';

async function request(path, { method, body }) {
  const response = await fetch(BASE_URL + path, { method, credentials: 'include', ... });
  if (!response.ok) { const error = new Error(data.error); error.errors = data.errors; throw error; }
  return data;
}
```
One function makes every call. `credentials: 'include'` sends the Litelo login cookie. If the backend says no, the error carries its message and its bullet list, which screens show as-is.

```js
export const misApi = { getConfig, getEnterprises, getCatalog, listTemplates, createTemplate, ...,
  previewReport, startExport, listHistory, getHistoryItem, fileUrl, listSchedules, createSchedule, ... };
```
One named function per endpoint, so screens read like `misApi.duplicateTemplate(id)`.

```js
export function downloadFile(url) {
  const link = document.createElement('a'); link.href = url; link.click(); link.remove();
}
```
Downloads via a plain link so the browser saves the file straight to disk. The old code loaded the whole file into the page's memory first, which would crash the tab for big reports.

---

### 6.6 `components/mis/MISReport.jsx` — the Report page

**What it is:** the container for the three tabs and everything they share.

```js
const [tab, setTab] = useState('templates');          // which tab is open
const [enterpriseId, setEnterpriseId] = useState(''); // shared by all tabs, like the prototype
const [workflow, setWorkflow] = useState('section138');
const [editing, setEditing] = useState(null);         // a template → show the Builder; null → show the list
const [rerun, setRerun] = useState(null);             // History "Run with latest data" request
```

```js
useEffect(() => { Promise.all([misApi.getConfig(), misApi.getEnterprises()]) ... }, []);
```
On open: load the settings and enterprises once; pick the first enterprise.

```js
const confirm = (options) => new Promise((resolve) => setConfirmState({ ...options, resolve }));
```
Replaces the browser's ugly `confirm()` with the prototype's own dialog. Screens write `if (await confirm({...}))`.

```js
const context = { config, enterprises, enterpriseName(id), workflowLabel(key), operatorsFor(field), toast, confirm };
<MisContext.Provider value={context}>
```
Puts shared tools where every screen can reach them (instead of passing them down by hand).

```js
const startNew = () => setEditing({ id: null, name: '', ..., status: 'Draft', columns: [], filters: [] });
const runAgain = (item) => { setEnterpriseId(item.enterpriseId); setRerun({...}); openTab('download'); };
```
New report starts as an empty Draft for the current enterprise and workflow. "Run with latest data" opens the Download tab with the same report and dates (spec US-4.3).

---

### 6.7 `components/mis/ui.jsx` — shared pieces

| Piece | What it is |
|---|---|
| `MisContext`, `useMis()` | Access to the shared tools above. |
| `Modal` | Grey overlay + white box; closes on Escape or clicking outside. |
| `ConfirmDialog` | "Delete this report?" with Cancel and a red/primary button. |
| `Toast` | The small dark message at the bottom ("Saved …"). |
| `ErrorList` | The red "Fix these before saving" box with bullets. |
| `EnterpriseSelect` | Enterprise dropdown (filter-bar style, or form style in the Builder). |
| `WorkflowSwitch` | The Section 138 / Section 25 / SARFAESI buttons. |
| `DataTable` | The preview table; right-aligns numbers; optional "Total (n cases)" row summing amounts. |
| `describeFilter` | A filter in words: "loan amount more than ₹50,000". Used for chips and the sentence. |
| `ReportSentence` | "One row per case from **Section 138** for **ABC Bank**, where **Notice date** falls…". Missing pieces in red (spec US-2.7). |

---

### 6.8 `components/mis/format.js` — formatting

```js
export function toIsoDate(date) { return `${y}-${m}-${d}` }   // local calendar, never UTC
```
The old code used `toISOString()`, which converts to UTC and gave **30 Sep** for "This month" in India before 05:30 am.

| Helper | Example |
|---|---|
| `formatDate` | `2026-10-05` → `05 Oct 2026` |
| `formatTime` | → `09:30 am` |
| `relativeDay` | → `Today` / `Yesterday` / `3 days ago` |
| `formatInr` | `125000` → `₹1,25,000` (Indian grouping) |
| `formatCount`, `plural` | `1284512` → `12,84,512`; `plural(3,'column')` → `3 columns` |
| `formatCell` | One preview cell by type |
| `DATE_PRESETS`, `presetRange` | Last 7 days, This month, Last month, This quarter, This financial year (from 1 April), Custom |

---

### 6.9 `components/mis/sample-data.js`

Makes 5 believable fake rows for the Builder's "Preview — sample data" panel, based on each column's type and name (names, courts, dates, ₹ amounts). Uses a fixed random seed, so the preview doesn't flicker on every keystroke. Real data is never used in the Builder.

---

### 6.10 `components/mis/TemplateList.jsx` — Screen 1

```js
useEffect(() => { load templates + catalog for this enterprise and workflow }, [enterpriseId, workflow]);
const visible = templates.filter((t) => `${t.name} ${t.description}`.toLowerCase().includes(term));
```
Loads the list when enterprise or workflow changes. Search filters instantly in the browser, matching name **and** description (US-1.2).

```js
const remove = async (template) => {
  const yes = await confirm({ title: 'Delete this report?', body: `"${template.name}" will be removed... Past downloads stay in History.` });
  const { stoppedSchedules } = await misApi.deleteTemplate(template.id);
  toast(`Deleted "${template.name}"${stoppedSchedules ? '. Its scheduled email was stopped.' : ''}`);
};
```
Spec US-1.4: confirm naming the report; tell the user if a schedule stopped.

Table columns: Report (+ description), Date range applies to, Columns, Status pill (green Active / amber Draft), Updated (relative + who), Edit / Duplicate / Delete. Empty state names the client and workflow (US-1.1).

---

### 6.11 `components/mis/ReportBuilder.jsx` — Screen 2

```js
const [draft, setDraft] = useState(initial);   // the template being edited, held on screen until Save
useEffect(() => { misApi.getCatalog(draft.workflow).then(setFields) }, [draft.workflow]);
const sample = useMemo(() => sampleTable(draft.columns, fieldsByKey), [...]);
```
Loads the column list for the chosen workflow; rebuilds the sample preview when columns change.

```js
const changeWorkflow = async (workflow) => {
  if (draft.columns.length || draft.filters.length) { const yes = await confirm({ title: 'Switch workflow?', ... }); }
  set({ workflow, dateBasis: '', columns: [], filters: [] });
};
```
Spec US-2.1: switching workflow asks first, then clears columns and filters.

```js
const save = async () => {
  try { saved = isNew ? await misApi.createTemplate(draft) : await misApi.updateTemplate(draft.id, draft); onSaved(saved); }
  catch (err) { setErrors(err.errors.length ? err.errors : [err.message]); }
};
```
The **backend** checks everything; the Builder shows the backend's list. One set of rules, so screen and server can never disagree.

Layout (left): Step 1 details, Step 2 date basis (only single dates, grouped), Step 3 `ColumnPicker`, Step 4 `FilterEditor`. Right (sticky): sentence, sample preview, errors, Cancel / Save.

---

### 6.12 `components/mis/ColumnPicker.jsx` — Builder Step 3

```js
const available = fields.filter((f) => (!group || f.group === group) && (!term || `${f.label} ${f.group}`.includes(term)));
const toggle = (field) => onChange(selected.has(field.key) ? remove : [...columns, { key, label: field.label, mv: 'latest' }]);
const move = (index, step) => swap with neighbour;
```
Left: searchable, group-filtered table with checkboxes, "calc" and "repeats" tags (US-2.3). Right: chosen columns in file order, with a heading box (US-2.4), a latest/first/all/count dropdown for repeating ones (US-2.5), ↑ ↓ ✕, and Clear all.

**PM note:** the ↑ ↓ reorder buttons follow the prototype, but `MIS Report.md` lists column order as a v1 non-goal. Decide which wins.

---

### 6.13 `components/mis/FilterEditor.jsx` — Builder Step 4

```js
const changeField = (index, key) => update(index, { key, op: firstOperatorOfThatType, value: enum ? [] : '' });
const changeOperator = (index, op) => update(index, isNoValueOperator(op) ? { op, value: '' } : { op });
```
Choosing a field resets the condition to one that fits its type; "is empty" etc. clear the value.

```js
function ValueInput({ field, filter }) {
  enum → multi-select of options;  last/next N days → "Days" number box
  date → date picker;  amount/number → number box;  text → text box;  no-value condition → nothing
}
```
The value box changes with the field type (US-2.6). Added filters also show as chips in plain words.

---

### 6.14 `components/mis/ReportDownload.jsx` — Screen 3

```js
useEffect(() => { misApi.listTemplates({ enterpriseId, status: 'Active' }) ... }, [enterpriseId]);
```
Only **Active** reports (US-3.1), all workflows, grouped by workflow as radio cards.

```js
const choosePreset = (key) => { setPreset(key); setRange(presetRange(key)); };
const changeDate = (which, value) => { setPreset('custom'); ... };   // typing a date switches to Custom (US-3.1)
```
"This month" is the default.

```js
async function generate(template, dates) {
  if (!dates.from || !dates.to) return toast('Choose both a start and an end date.');
  if (dates.from > dates.to) return toast('The start date is after the end date.');
  const [preview, fields, schedules] = await Promise.all([previewReport, getCatalog, listSchedules]);
  setResult({ template, fieldsByKey, range, generatedAt: new Date(), preview });
}
```
Loads the real preview, the column info (for the sentence) and any existing schedule at the same time.

```js
// Rerun from History: once templates are loaded, select the report, set Custom dates, generate.
generateRef.current(template, {...}).then(() => toast('Rebuilt with the latest data'));
if (!template) toast('That report has been deleted or set to Draft, so it cannot be re-run.');   // US-4.3
```

`ResultPanel` shows: name + "ABC Bank · Section 138 · dates · generated time" (US-3.2), **Download CSV / Download Excel / ✉ Email**, a progress bar while a file builds ("You can leave this page; the file will also be in History"), the schedule bar with Edit / Cancel (US-3.5), the sentence, the real preview table, and "Showing the first 50 of 12,84,512 rows. The file includes every row."

---

### 6.15 `components/mis/useExportJob.js` — download with progress

```js
const start = async (request) => setJob(await misApi.startExport(request));    // queue the file
useEffect(() => {
  if (job is queued or running) every 1.5 s: latest = await misApi.getHistoryItem(job.id);
    if (latest.status === 'done')   downloadFile(misApi.fileUrl(latest.id)); toast('Downloaded as Excel. Saved to History.');
    if (latest.status === 'failed') toast(latest.error);
}, [job]);
```
The browser side of the "order slip" flow from section 1.

---

### 6.16 `components/mis/EmailScheduleModal.jsx` — "Email this report"

```js
const addTyped = () => { validate the typed address; add as a chip; or show '"x" is not a valid email address.' };
onKeyDown: Enter / comma / space → add;  Backspace on empty → remove last chip
```
Fields: Send to (chips), How often, Time (IST), Keep sending until (default 3 months), File format. Explanation note: each email covers the same number of days, ending on the send date.

```js
if (existing) onSaved(await misApi.updateSchedule(existing.id, body), false);   // edit: no email now
else onSaved((await misApi.createSchedule(body)).schedule, true);              // new: first email now
```

---

### 6.17 `components/mis/ReportHistory.jsx` — Screen 4

```js
useEffect(() => { wait 300 ms after typing, then search }, [search]);         // don't call the server on every key
const fetchPage = () => misApi.listHistory({ enterpriseId, search, limit: 20, offset: page * 20 });
useEffect(() => { if any row is still building: refresh every 3 s }, [building, data]);
```

```js
function StatusCell({ item }) {
  failed → red "Failed" + reason;   queued → "Waiting…";   running → "Building · 4,20,000 rows"
  done   → Excel / CSV pill (+ "✉ Emailed")
}
```

```jsx
<button disabled={!(h.status === 'done' && h.hasFile)} title="Older than 90 days — use Run with latest data">Download again</button>
<button disabled={!h.templateId} title="This report has been deleted">Run with latest data</button>
```
"Download again" = the exact old file (US-4.2). "Run with latest data" = rebuild with today's data (US-4.3). The note above the table explains the difference, as the spec asks. Pages of 20 with Previous / Next.

---

### 6.18 `components/mis/mis-report.css`

**Section 1** is copied unchanged from `litelo-reports-v2.html` — same class names, colours, light and dark themes — which is why the screens look identical to the prototype. **Section 2** adds the few states the prototype didn't need: failed pill, loading text, progress bar, pager, time-input style, and long file names wrapping.

---

## 7. Demo mode

### `backend/demo/demo-server.js`

**What it is:** a stand-in backend with the **same endpoints and replies** as the real one, but no database. Data is kept in memory and lost on restart.
**When to use it:** `npm run demo`, to try the screens without SIT access.

```js
const { validateTemplate, ... } = require('../utils/validators');     // REAL validation
const { createReportWriter } = require('../services/report-writers'); // REAL Excel/CSV writers
const { getPublicFields } = require('../config/column-catalog');      // REAL column list
```
Everything except the data is the production code, so what you see in the demo is how the product behaves.

```js
const templates = [ 'Notice dispatch tracker', 'Court pipeline', 'Weekly recovery snapshot' (Draft) ];
const DEMO_ROWS_PER_REPORT = 25000;
async function buildFile(job, template) { writes 25,000 fake rows in batches, with a short pause so the progress bar is visible }
if (job.delivery === 'Email') console.log('[demo] would email ...');   // never sends real email
```

### `backend/demo/sample-rows.js`

Fake rows in exactly the shape the real query returns. Row number N always gives the same values, so the preview and the downloaded file agree.

---

## 8. Tests

Run with `cd backend && npm test`. They need no database and finish in about 2 seconds.

| File | What it proves |
|---|---|
| `query-builder.test.js` | Enterprise and dates are parameters; **user text never enters the SQL** (tries `'; DROP TABLE…`); only needed joins are added, in the right order; repeating columns use sub-queries (no duplicate rows); every filter condition produces the right SQL; removed columns give a clear error. |
| `validators.test.js` | A good template is cleaned (default headings, duplicates dropped); missing name, date, columns and filter values are **all** listed; wrong conditions rejected; date range rules; bad emails named, past end date rejected. |
| `dates.test.js` | "Today" is Indian, not UTC; range length counts both ends; 09:00 IST = 03:30 UTC; weekly next send; missed sends skipped after downtime; 31 Jan + 1 month = 28 Feb. |
| `report-writers.test.js` | CSV: UTF-8 mark, quoting, Hindi kept, formula injection blocked, negatives untouched. Excel: real dates and numbers, bold header, formulas stored as text, empty report still has headings. |

**What tests do NOT cover yet:** running the SQL on a real database, and the React screens. Both are on the deployment checklist.

---

## 9. Four journeys traced through the code

### A. Save a new report
1. **TemplateList.jsx** — "New report" → `MISReport.startNew()` → Builder opens with an empty Draft.
2. **ReportBuilder.jsx** — user fills the 4 steps; the sentence and sample preview update live.
3. "Save report" → **mis-api.js** `createTemplate` → `POST /api/mis/templates`.
4. **auth.js** `requireUser` → **report.routes.js** checks enterprise access → **template.service.js** `createTemplate`.
5. **validators.js** `validateTemplate` — problems → 400 with the list → Builder shows "Fix these before saving".
6. OK → INSERT into `cms.report_templates` (duplicate name → friendly message) → 201 → toast "Saved …", back to the list.

### B. Download Excel with 2 million rows
1. **ReportDownload.jsx** — pick report + dates → "Generate report" → `POST /reports/preview` → **report.service.js** returns 50 rows + total count.
2. "Download Excel" → **useExportJob.js** `start` → `POST /reports/export` → **history.service.js** `queueExport` inserts a `queued` row → **202** immediately.
3. **export-worker.js** claims the job (`claimNextJob`) → `prepareExport` builds the SQL (**query-builder.js**) → cursor reads 5,000 rows at a time → **report-writers.js** writes them to disk, starting sheet "Report (2)" after 1,048,575 rows → progress saved every 3 s.
4. Browser polls `GET /history/:id` → progress bar grows.
5. Status `done` → `downloadFile` → `GET /history/:id/file` → browser saves `Court_pipeline_ABCBank_20261005.xlsx`.
6. The row stays in History; "Download again" serves the same file for 90 days.

### C. Weekly email
1. **EmailScheduleModal.jsx** → `POST /schedules` → **schedule.service.js** `createSchedule`: saves range length (e.g. 7 days), `next_run_at` = next week 09:00 IST, and queues the **first email now**.
2. **export-worker.js** builds the file → **email.service.js** sends it (or "download from History" if over 20 MB).
3. Every minute **scheduler.js** → `claimDueSchedule`: when `next_run_at` passes, moves it a week forward, then queues an email for the 7 days ending today.
4. Stops after `end_date`, when cancelled, or when the template is deleted. Draft template → skipped.

### D. Run with latest data (from History)
1. **ReportHistory.jsx** → "Run with latest data" → `MISReport.runAgain` stores `{templateId, dates}` and opens the Download tab.
2. **ReportDownload.jsx** waits for the Active list, selects the report, sets Custom dates, generates → toast "Rebuilt with the latest data".
3. Template deleted or Draft → "That report has been deleted or set to Draft, so it cannot be re-run." (US-4.3)

---

## 10. Settings you can change without code

All in `backend/.env` (template: `backend/.env.example`). Restart the backend after changing.

| Setting | Default | Meaning |
|---|---|---|
| `PORT` | 5000 | Backend port |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL` | — | Database connection |
| `DB_POOL_MAX` | 10 | Max open database connections |
| `MIS_DEV_USER_ID`, `MIS_DEV_USER_EMAIL` | — | Fake signed-in user. **Local only — never on a server.** |
| `MIS_EXPORT_DIR` | `backend/exports` | Where files are saved |
| `MIS_EXPORT_BATCH_SIZE` | 5000 | Rows read per batch |
| `MIS_MAX_CONCURRENT_EXPORTS` | 2 | Files built at once per server |
| `MIS_EXPORT_TIMEOUT_MINUTES` | 60 | Max time for one file's query |
| `MIS_FILE_RETENTION_DAYS` | 90 | Days a file is kept (spec US-4.2) |
| `MIS_PREVIEW_ROWS` | 50 | Rows in the on-screen preview |
| `MIS_PREVIEW_TIMEOUT_SECONDS` | 60 | Max time for a preview |
| `MIS_RUN_WORKERS` | true | Whether this server builds files and sends emails |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | — | Email server. Empty = emails are only logged. |
| `MIS_EMAIL_FROM` | Litelo Reports | Sender |
| `MIS_EMAIL_MAX_ATTACHMENT_MB` | 20 | Bigger files are not attached |

Frontend: `REACT_APP_MIS_API_URL` (API address, if not same site), `MIS_BACKEND_URL` (dev proxy target).

Code-level product values (need an SDE): ageing bucket ranges (`column-catalog.js`), validation wording and limits (`validators.js`), date presets (`format.js`), email text (`email.service.js`), stalled-job time 15 min (`scheduler.js`).

---

## 11. Known limits and open questions

**Not yet verified**
- No SQL has run against the real database. Seven assumptions are listed at the top of `LITELO_COLUMNS.md`.
- The React screens have no automated tests.

**Design limits**
- Files live on one server's disk → needs shared storage or S3 with more than one server.
- Every signed-in user can see every enterprise until `assertEnterpriseAccess` is written.
- Downloads use a link, so the API must accept the login **cookie** (not only a token in JavaScript).
- If an email fails after the file was built, the History row shows "Failed" with the reason; the file is not offered for download.

**Product decisions open** (see `DEPLOYMENT_CHECKLIST.md` Phase 9)
1. Column reordering: keep (prototype) or remove (spec non-goal)?
2. Section 25 / SARFAESI base tables.
3. Which missing prototype columns are needed for launch (Batch ID, cheque amount, notice delivery, settlement, legal cost…).
4. Who may build templates vs. only download; client logins.
5. Restrict email recipients to client domains? Attachment limit?
6. Ageing bucket: ranges, and count from case creation or from dishonour date?

**Good questions to open the SDE discussion**
- "Walk me through what happens between clicking Download Excel and the file arriving." (Journey B.)
- "What breaks first if 20 people download a year of data at the same time?"
- "Which of the seven database assumptions are you least sure about?"
- "How will Litelo's login reach `req.user`, and does it use cookies?"
- "One server or several in production? Where should report files live?"
- "What would we need to change to add Section 25?"
