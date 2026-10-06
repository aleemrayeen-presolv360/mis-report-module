# Litelo Platform – System Context (SIT)

> Extracted from DBeaver ER diagrams (Postgres `sit_lwms`) and UI screenshots of `sit.litelo.ai`.
> Purpose: give an AI coding assistant full context of the data model and admin UI.

## 1. Overview

**Litelo** is an AI-driven legal workflow platform (by Presolv360) for banks/NBFCs handling recovery litigation:
Cheque Bounce (Sec. 138 NI Act), EFT Dishonour, SARFAESI, and court case tracking.

- Environment: SIT — `https://sit.litelo.ai`
- Database: PostgreSQL, database `sit_lwms`, split into **6 schemas** (one per service):

| Schema | Responsibility |
|---|---|
| `auth` | Accounts, organizations (enterprises), roles, members, invitations, sessions, cross-org access |
| `casebridge` | Per-enterprise field mappings by case type (bulk upload → case fields) |
| `cms` | Case management: cheque cases, litigants, drafts, documents, proceedings, audit trail, bulk worker runs |
| `courtbridge` | eCourts sync: case data by CNR, hearings, parties, advocates, court documents, CNR bulk uploads |
| `digiserve` | Communications: channels/vendors, templates, outbound requests, webhooks, replies |
| `workflow` | Workflow engine: definitions, scopes, executions, event log, timers, outbox, activity catalog |

### Type legend (inferred from DBeaver icons)
`uuid` = id-card icon · `text` = A-Z · `int` = 123 · `timestamptz` = clock · `jsonb` = { } · `bool` = checkbox · `inet` = ip icon · `text[]` = array icon.
**PK** = primary key, **FK** = foreign key (drawn in ERD), **ref** = logical reference (no FK drawn, likely cross-schema).

### Cross-schema conventions
- `enterprise_id` (everywhere) → logical ref to `auth.organization.id`
- `created_by` / `updated_by` / `uploaded_by` / `performed_by` / `enqueued_by` → logical ref to `auth.account.id`
- `case_id` + `case_type` → polymorphic ref to a case table in `cms` (e.g. `cms.cheque.id` when case_type = cheque)
- `cnr` (Case Number Record, 16-char eCourts ID) links `cms.cheque.cnr` ↔ `courtbridge.ecourt_cases.cnr`
- `workflow_execution_id` (cms.cheque) → `workflow.executions.id`

---

## 2. Schema `auth`

```
account
  id uuid PK
  first_name text, last_name text, email text
  password_hash text, profile_pic_url text
  is_active bool, email_verified bool
  created_by uuid FK→account.id, updated_by uuid FK→account.id
  created_at timestamptz, updated_at timestamptz

organization            -- "enterprise" elsewhere
  id uuid PK
  name text, organization_type text
  state text, city text, address text, pincode text
  is_active bool
  created_by uuid FK→account.id, updated_by uuid FK→account.id
  created_at, updated_at

role
  id uuid PK
  organization_id uuid FK→organization.id
  name text
  permissions jsonb
  created_by uuid FK→account.id, updated_by uuid FK→account.id
  created_at, updated_at

member                  -- account's membership in its home org
  id uuid PK
  account_id uuid FK→account.id
  organization_id uuid FK→organization.id
  role_id uuid FK→role.id
  created_by uuid FK→account.id, updated_by uuid FK→account.id
  created_at, updated_at

member_org_access       -- cross-org access (UI: "Cross-Org Access")
  member_id uuid PK, FK→member.id
  organization_id uuid PK, FK→organization.id
  role_id uuid FK→role.id
  created_by uuid FK→account.id, updated_by uuid FK→account.id
  created_at, updated_at

invitation
  id int PK
  email text
  organization_id uuid FK→organization.id
  role_id uuid FK→role.id
  invited_by uuid FK→account.id
  token_hash text, status text
  expires_at, accepted_at, created_at, updated_at

sessions
  id uuid PK
  account_id uuid FK→account.id
  session_token text, ip_address inet, user_agent text
  expires_at, created_at, updated_at
```

---

## 3. Schema `casebridge`

```
mappings
  id uuid PK
  enterprise_id uuid  ref→auth.organization.id
  case_type text
  mapping jsonb       -- field mapping config
  version int
  is_active bool
  created_by uuid, created_at, updated_at
```

---

## 4. Schema `cms`

```
cheque                  -- main case table for Cheque Bounce (Sec. 138)
  id uuid PK
  -- identifiers
  case_number text, cnr text, ref_number text, agreement_number text, file_number text
  notice_id text, court_case_number text
  -- loan / cheque
  nature_of_agreement text, loan_amount numeric, outstanding_amount numeric
  disbursal_date, cheque_number text, cheque_date, bank_name_branch text, account_number text
  presentation_date, cheque_bounce_reason text, bounce_memo_reference text, return_memo_date
  -- notice / filing / court
  notice_due_date, notice_date, case_filing_date
  jurisdiction text, court_name text
  -- parties / advocate
  name_of_advocate text, designation_of_advocate text
  client_name text, client_registered_office text, contact_person_for_claimant text
  -- ownership
  enterprise_id uuid ref→auth.organization.id
  member_id uuid ref→auth.member.id
  language text
  -- lifecycle
  status text, stage text, substage text, event text, reason text, remarks text
  -- workflow linkage
  workflow_execution_id uuid ref→workflow.executions.id
  workflow_status text, workflow_event_seq int
  workflow_automation_disabled bool
  meta jsonb
  created_by uuid, updated_by uuid, created_at, updated_at

litigants
  id int PK
  case_id uuid, case_type text, enterprise_id uuid
  user_id uuid
  full_name text, email text, contact jsonb
  role text                 -- claimant / respondent etc.
  respondent_status text, father_name text, is_primary_respondent bool
  created_by uuid, updated_by uuid, created_at, updated_at

litigant_addresses
  id int PK
  litigant_id int FK→litigants.id
  address text, pincode text
  created_at, updated_at

drafts                    -- generated legal drafts (notices, complaints)
  id uuid PK
  case_id uuid, case_type text, enterprise_id uuid
  litigant_id int FK→litigants.id
  draft_type text, direction text, name text, path text
  template_id text, template_version text, generated_by text
  created_by uuid, created_at, updated_at

documents                 -- uploaded case documents
  id uuid PK
  case_id uuid, case_type text, enterprise_id uuid
  doc_type text, name text, path text
  uploaded_by uuid, created_at, updated_at

proceedings               -- case milestones
  id int PK
  case_id uuid, case_type text, enterprise_id uuid
  milestone_type text, milestone_date timestamptz
  remark text, status text
  created_by uuid, updated_by uuid, created_at, updated_at

audit_trail
  id int PK
  case_id uuid, case_type text, enterprise_id uuid
  action text, field_name text, old_value text, new_value text
  actor_type text, performed_by uuid
  metadata jsonb, created_at

worker_runs               -- bulk upload / background job tracking
  id uuid PK
  case_type text, enterprise_id uuid
  action text, file_name text, file_path text, status text
  total_records int, processed_records int, failed_records int
  error_message text, enqueued_by uuid
  completed_at, created_at, updated_at
```

---

## 5. Schema `courtbridge`

```
ecourt_cases
  cnr text PK
  case_number text, case_type_raw text, case_type_display text
  filing_number text, filing_date
  registration_number text, registration_date
  case_status text, court_number_and_judge text
  first_hearing_date, next_hearing_date, decision_date
  acts jsonb, metadata jsonb
  synced_at, created_at, updated_at

ecourt_case_hearings
  id int PK, cnr text FK→ecourt_cases.cnr
  hearing_date, judge_name text, business_date text, purpose text
  created_at, updated_at

ecourt_case_parties
  id int PK, cnr text FK→ecourt_cases.cnr
  role text, name text, created_at, updated_at

ecourt_case_advocates
  id int PK, cnr text FK→ecourt_cases.cnr
  role text, name text, created_at, updated_at

ecourt_documents
  id int PK, cnr text FK→ecourt_cases.cnr
  doc_type text, title text, doc_date, description text
  original_file_name text, file_path text, sort_order int
  created_at, updated_at

cases                     -- which enterprise tracks which CNR
  id uuid PK
  enterprise_id uuid, cnr text
  created_at, updated_at

cnr_upload_batches        -- bulk CNR upload for Case Tracker
  id uuid PK
  enterprise_id uuid
  source text, file_name text, status text
  total_submitted int, valid_count int, invalid_count int, duplicate_count int
  processed_count int, succeeded_count int, failed_count int
  pending_cnrs jsonb, invalid jsonb, duplicates jsonb
  error text
  created_at, updated_at, started_at, completed_at
```

---

## 6. Schema `digiserve`

```
communication_channel     -- vendor config (SMS/WhatsApp/Email)
  id uuid PK
  vendor_name text, communication_mode text
  sender_id text, sender_contact text
  api_key text             -- ⚠ stored as plain text column
  status text, created_at, updated_at

communication_template
  id uuid PK
  communication_channel_id uuid FK→communication_channel.id
  template_bucket_code text, vendor_template_id text
  language text, content text
  required_variables text[], button_variables jsonb
  template_header_type text
  status text, approval_status text
  created_at, updated_at

communication_request     -- each outbound message
  id uuid PK
  case_id text, case_type text, case_number text
  reference_id text, consumer_id text
  sender_id text, sender text, receiver text
  communication_mode text, communication_type text
  subject text, content text
  template_id text, requested_bucket_code text, variables jsonb
  attachment_url text, language text
  status text, attempt_count int
  message_request_id text, communication_id text
  response jsonb, error_message text, sent_at
  reply_token text
  respondent_party_id int, respondent_name text, claimant_name text, organization_name text
  case_data jsonb, settlement_offer jsonb, court_case_data jsonb
  created_at, updated_at

communication_webhook_log -- vendor delivery callbacks
  id uuid PK
  communication_request_id uuid FK→communication_request.id
  case_id text, message_request_id text
  status text, error_message text, communication_mode text
  response text, metadata jsonb
  timestamp timestamptz, created_at

reply                     -- respondent replies (via reply_token)
  id uuid PK
  case_id text, reply_token text
  communication_mode text, reply_proceeding_type text
  reply_data jsonb, activity_log jsonb, attachments jsonb
  created_at, updated_at

communication_request_reference_dupes   -- no PK shown
  id uuid, reference_id text, created_at
```

---

## 7. Schema `workflow`

```
workflows                 -- versioned workflow definitions
  id uuid PK
  enterprise_id uuid, case_type text
  name text, status text   -- draft / active
  version int
  family_id uuid           -- groups versions of the same workflow
  definition jsonb         -- stages, transitions, activities
  created_by uuid, updated_by uuid, created_at, updated_at

workflow_scopes           -- where a workflow applies (UI: Product × Jurisdiction)
  id uuid PK
  workflow_id uuid FK→workflows.id
  enterprise_id uuid, case_type text
  product_type text        -- e.g. cheque, PERSONAL_LOAN
  jurisdiction text        -- e.g. ANDHRA_PRADESH, DELHI
  created_at

executions                -- workflow instance per case
  id uuid PK
  workflow_id uuid FK→workflows.id, version int
  enterprise_id uuid, case_id uuid, case_type text
  current_stage_key text, stage_entry_seq int, stage_entered_at
  last_event_seq int
  status text, awaiting_input bool   -- UI: "Awaiting Input"
  metadata jsonb
  started_at, completed_at, created_at, updated_at

execution_events          -- event-sourced log
  id int PK, occurred_at timestamptz PK   -- composite PK (likely partitioned by time)
  execution_id uuid FK→executions.id
  seq int, type text, payload jsonb, idempotency_key text

timers                    -- scheduled stage timers with retry
  id uuid PK
  execution_id uuid FK→executions.id
  stage_key text, stage_entry_seq int
  kind text, fire_at, payload jsonb, status text
  attempt_count int, max_attempts int, retry_delay_seconds int, backoff_coefficient numeric
  last_attempted_at, fired_at, error text, created_at

outbox                    -- transactional outbox for side effects (e.g. communications)
  id uuid PK
  execution_id uuid FK→executions.id
  kind text, payload jsonb, idempotency_key text, status text
  communication_id text, provider_message_id text, response jsonb
  attempt_count int, max_attempts int, next_attempt_at
  last_error text, sent_at, created_at

activities                -- catalog of activity types usable in workflow definitions
  id uuid PK
  type text, code text, name text, case_type text, group_name text
  config_schema jsonb, default_config jsonb
  is_active bool, created_at, updated_at
```

---

## 8. Relationship summary (FKs drawn in ERDs)

```
auth.sessions.account_id            → auth.account.id
auth.invitation.organization_id     → auth.organization.id
auth.invitation.role_id             → auth.role.id
auth.invitation.invited_by          → auth.account.id
auth.role.organization_id           → auth.organization.id
auth.member.account_id              → auth.account.id
auth.member.organization_id         → auth.organization.id
auth.member.role_id                 → auth.role.id
auth.member_org_access.member_id    → auth.member.id
auth.member_org_access.organization_id → auth.organization.id
auth.member_org_access.role_id      → auth.role.id
auth.*.created_by / updated_by      → auth.account.id

cms.drafts.litigant_id              → cms.litigants.id
cms.litigant_addresses.litigant_id  → cms.litigants.id

courtbridge.ecourt_case_hearings.cnr   → courtbridge.ecourt_cases.cnr
courtbridge.ecourt_case_parties.cnr    → courtbridge.ecourt_cases.cnr
courtbridge.ecourt_case_advocates.cnr  → courtbridge.ecourt_cases.cnr
courtbridge.ecourt_documents.cnr       → courtbridge.ecourt_cases.cnr

digiserve.communication_template.communication_channel_id → digiserve.communication_channel.id
digiserve.communication_webhook_log.communication_request_id → digiserve.communication_request.id

workflow.executions.workflow_id        → workflow.workflows.id
workflow.workflow_scopes.workflow_id   → workflow.workflows.id
workflow.execution_events.execution_id → workflow.executions.id
workflow.timers.execution_id           → workflow.executions.id
workflow.outbox.execution_id           → workflow.executions.id
```

---

## 9. Frontend (sit.litelo.ai)

### Main app navigation (`/platform/...`)
| Menu | Likely backing data |
|---|---|
| Dashboard (`/platform/dashboard`) | counts from `auth` |
| Cheque Bounce | `cms.cheque` + related cms tables |
| EFT Dishonour | cms (case_type = EFT) |
| Sarfaesi | cms (case_type = sarfaesi) |
| Case Tracker | `courtbridge.*` |

**Dashboard** shows: "Welcome back, {first_name}", stat cards **10 Organizations / 20 Users / 19 Members**, Quick Actions: *Create Organization*, *Add User*, *Create Role*. Header shows logged-in user name + email with dropdown.

### Settings navigation (`/platform/settings/...`)
| Menu | Backing table(s) |
|---|---|
| Organizations (`/settings/organizations`) | `auth.organization` |
| Users | `auth.account` (+ `auth.member`) |
| Roles | `auth.role` |
| Cross-Org Access | `auth.member_org_access` |
| Mapping | `casebridge.mappings` |
| Workflows (`/settings/workflows`) | `workflow.workflows` + `workflow.workflow_scopes` |
| Communication | `digiserve.communication_channel`, `communication_template` |
| Awaiting Input | `workflow.executions` where `awaiting_input = true` |

### Organizations page
- Title "Organizations" + total badge, subtitle "Create and manage enterprise organizations and their specific role configurations."
- Search box, **+ Create** button, row action menu (⋮), pagination (rows per page 10).
- Columns: **Organization Name** (avatar initials) · **Location** (`city, state`) · **Created** (date + "by {creator email}") · **Updated** (date + "by {updater email}") · **Status** (Active / Inactive from `is_active`).

Current SIT data (10 total, 7 visible):
| Name | Location | Created | Status |
|---|---|---|---|
| presolv362 | Mumbai, Maharashtra | 02 May 2026 | Active |
| Freedom Bank | Mumbai, Maharashtra | 03 Jun 2026 | Active |
| ACME BANK | Mumbai, Maharashtra | 02 Aug 2026 | Active |
| ABC Bank | Mumbai, Maharashtra | 03 Aug 2026 | Inactive |
| Bank Of Bharosa | Mumbai, Maharashtra | 19 Aug 2026 | Active |
| Forward Proxy | min, chim | 27 Aug 2026 | Active |
| Vastu Finserve | Mumbai, Maharashtra | 28 Aug 2026 | Active |

Other enterprises (from Workflows page): TUNA, MTA T1, MTA 3.

### Workflows page
- Two-pane layout: left **Enterprises** list (select one), right workflows table for the selected enterprise.
- Title "Workflows" + total badge (22 for presolv362), subtitle "Design and manage workflow definitions per enterprise."
- Search box, **+ New Workflow** button, pagination (3 pages).
- Columns: **Name** (with sub-label = case type/family, e.g. `section138`, `sarfaesi`) · **Product × Jurisdiction** chip (from `workflow_scopes`) · **Version** (`v1`, `v2`…) · **Status** (`draft` red / `Active` green) · **Created** (date + by) · **Updated** (date + by).

Sample rows (presolv362):
| Name | Sub-label | Product × Jurisdiction | Ver | Status |
|---|---|---|---|---|
| 11 | sarfaesi | cheque × ANDHRA_PRADESH | v1 | draft |
| Testing_QA_24 Sep | section138 | cheque × JHARKHAND | v1 | draft |
| super admin | section138 | cheque × ANDHRA_PRADESH | v1 | Active |
| Testing_QA | section138 | cheque × DELHI | v1 | draft |
| Aleem Rayeen v2 v3 | section138 | PERSONAL_LOAN × ANDHRA_PRADESH | v3 | Active |
| Aleem Rayeen v2 | section138 | PERSONAL_LOAN × ALLAHABAD | v2 | Active |
| Aleem Rayeen | section138 | PERSONAL_LOAN × ORISSA | v1 | Active |

### UI conventions
- Dates formatted `DD Mon YYYY` (e.g. "25 Sept 2026"); audit shown as "by {email}".
- Avatars use initials of the name.
- Status chips: green outline = Active, red = draft, dark = Inactive.
- Collapsible left sidebar.

---

## 10. Observations / things to watch
- No DB-level FKs across schemas — `enterprise_id`, `created_by`, `case_id`, `cnr` integrity is enforced in application code.
- `case_id` is `uuid` in cms/workflow but `text` in digiserve.
- `digiserve.communication_channel.api_key` appears to be a plain text column.
- `communication_request_reference_dupes` has no primary key.
- Some workflows mix sub-label and product (e.g. "11": `sarfaesi` but product `cheque`) — possible data-quality issue.
- "Forward Proxy" org has placeholder location "min, chim".
