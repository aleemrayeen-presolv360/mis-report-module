# Litelo MIS — Report Columns

> Generated from `backend/config/column-catalog.js` by `npm run docs:columns`. Do not edit by hand — change the catalog and regenerate.

Use this file to check every report column against the real database (`sit_lwms`).
Tick ☐ → ☑ once a column is verified on SIT data.

**How a column becomes SQL:** every report is `SELECT … FROM <base table> c [joins] WHERE c.enterprise_id = $1 AND <date basis> BETWEEN $2 AND $3 AND <filters>`.
A *repeating* column is read with a sub-query, so a case is always exactly one row.

## Database facts the columns rely on

All checked on SIT (read-only) on 05 Oct 2026. Re-run the check queries on production before go-live.

| ✓ | Fact | Affects | Check with |
|---|---|---|---|
| ☑ | `cms.litigants.case_type` is `'section138'` for Section 138 cases (was wrongly `'cheque'` — fixed) | Every Borrower, Proceedings and Drafts column | `SELECT DISTINCT case_type FROM cms.litigants;` |
| ☑ | Exactly one litigant per case has `is_primary_respondent = true` (0 duplicates, 0 missing) | Borrower name, email, address… | `SELECT case_id, count(*) FROM cms.litigants WHERE is_primary_respondent GROUP BY 1 HAVING count(*) > 1;` |
| ☑ | Other respondents have `role = 'respondent'`; claimants have `role = 'claimant'` | Co-borrower / guarantor | `SELECT DISTINCT role FROM cms.litigants;` |
| ☑ | `communication_mode` values are `SMS`, `EMAIL`, `WHATSAPP` — upper case (was wrongly lower case — fixed) | SMS / Email / WhatsApp columns | `SELECT DISTINCT communication_mode FROM digiserve.communication_request;` |
| ☑ | `digiserve.communication_request.case_id` holds `cms.cheque.id` as text (69 of 121 rows match a Section 138 case) | Communication columns | `SELECT count(*) FROM digiserve.communication_request r JOIN cms.cheque c ON c.id::text = r.case_id;` |
| ☑ | `cms.litigants.contact` is JSON `{"mobile": [...], "whatsapp": [...]}` | Mobile, WhatsApp number | `SELECT contact FROM cms.litigants WHERE contact IS NOT NULL LIMIT 5;` |
| ☑ | `cms.cheque.status` is ONGOING / CLOSED; `stage` is Pre-Notice / Notice / Filing / Court / Closed (kept as text so new values still work) | Case status, Stage | `SELECT DISTINCT status, stage FROM cms.cheque;` |

**Run test on SIT, 05 Oct 2026:** every column below ran without error on real data. These columns were empty for every case (data not filled in on SIT yet, not a mapping error): File number, Drawer account number, Presentation date, Memo number, Last event, Reason, Case language, eCourts case type, Decision date, Milestone remark, Email sent at.

## Section 138 (`section138`)

Base table: `cms.cheque c` — one row per case. 89 columns.

### Case and batch

| ✓ | Key | Column | Type | Source | Notes |
|---|---|---|---|---|---|
| ☐ | `case_number` | Case number | Text | `c.case_number` |  |
| ☐ | `ref_number` | Reference number | Text | `c.ref_number` |  |
| ☐ | `agreement_number` | Agreement number | Text | `c.agreement_number` |  |
| ☐ | `file_number` | File number | Text | `c.file_number` |  |
| ☐ | `case_created_date` | Case created date | Date | `c.created_at` |  |
| ☐ | `case_updated_date` | Case last updated | Date | `c.updated_at` |  |

### Borrower

| ✓ | Key | Column | Type | Source | Notes |
|---|---|---|---|---|---|
| ☐ | `borrower_name` | Borrower name | Text | `respondent.full_name` | Needs join: respondent |
| ☐ | `borrower_father_name` | Father name | Text | `respondent.father_name` | Needs join: respondent |
| ☐ | `borrower_email` | Email | Text | `respondent.email` | Needs join: respondent |
| ☐ | `borrower_mobile` | Mobile | Text | `array_to_string(ARRAY(SELECT jsonb_array_elements_text(respondent.contact->'mobile')), ', ')` | Needs join: respondent |
| ☐ | `borrower_whatsapp` | WhatsApp number | Text | `array_to_string(ARRAY(SELECT jsonb_array_elements_text(respondent.contact->'whatsapp')), ', ')` | Needs join: respondent |
| ☐ | `borrower_status` | Borrower status | Text | `respondent.respondent_status` | Needs join: respondent |
| ☐ | `borrower_address` | Full address | Text | `respondent_address.address` | Needs join: respondentAddress |
| ☐ | `borrower_pincode` | Pincode | Text | `respondent_address.pincode` | Needs join: respondentAddress |
| ☐ | `co_borrower` | Co-borrower / guarantor | Text | `x.full_name` from `cms.litigants x` where `x.case_id = c.id AND x.case_type = 'section138' AND x.role = 'respondent' AND x.is_primary_respondent IS NOT TRUE` (ordered by `x.id`) | Repeats — user picks latest / first / all / count |

### Claimant

| ✓ | Key | Column | Type | Source | Notes |
|---|---|---|---|---|---|
| ☐ | `claimant_name` | Claimant name | Text | `c.client_name` |  |
| ☐ | `claimant_address` | Claimant registered address | Text | `c.client_registered_office` |  |
| ☐ | `claimant_contact` | Claimant contact person | Text | `c.contact_person_for_claimant` |  |

### Loan

| ✓ | Key | Column | Type | Source | Notes |
|---|---|---|---|---|---|
| ☐ | `nature_of_agreement` | Nature of agreement | Text | `c.nature_of_agreement` |  |
| ☐ | `loan_amount` | Loan amount | Amount | `c.loan_amount` |  |
| ☐ | `outstanding_amount` | Total outstanding | Amount | `c.outstanding_amount` |  |
| ☐ | `disbursal_date` | Disbursal date | Date | `c.disbursal_date` |  |

### Cheque

| ✓ | Key | Column | Type | Source | Notes |
|---|---|---|---|---|---|
| ☐ | `cheque_no` | Cheque number | Text | `c.cheque_number` |  |
| ☐ | `cheque_date` | Cheque date | Date | `c.cheque_date` |  |
| ☐ | `drawer_bank` | Drawer bank and branch | Text | `c.bank_name_branch` |  |
| ☐ | `drawer_account` | Drawer account number | Text | `c.account_number` |  |

### Dishonour

| ✓ | Key | Column | Type | Source | Notes |
|---|---|---|---|---|---|
| ☐ | `presentation_date` | Presentation date | Date | `c.presentation_date` |  |
| ☐ | `return_reason` | Bounce reason | Text | `c.cheque_bounce_reason` |  |
| ☐ | `memo_no` | Memo number | Text | `c.bounce_memo_reference` |  |
| ☐ | `memo_date` | Return memo date | Date | `c.return_memo_date` | Starts the 30-day notice window |

### Demand notice

| ✓ | Key | Column | Type | Source | Notes |
|---|---|---|---|---|---|
| ☐ | `notice_id` | Notice ID | Text | `c.notice_id` |  |
| ☐ | `notice_due_by` | Notice due by | Date | `c.notice_due_date` |  |
| ☐ | `notice_date` | Notice date | Date | `c.notice_date` |  |

### Complaint filing

| ✓ | Key | Column | Type | Source | Notes |
|---|---|---|---|---|---|
| ☐ | `filing_date` | Complaint filing date | Date | `c.case_filing_date` |  |
| ☐ | `court_name` | Court | Text | `c.court_name` |  |
| ☐ | `jurisdiction` | Jurisdiction | Text | `c.jurisdiction` |  |
| ☐ | `complaint_no` | Complaint (CC) number | Text | `c.court_case_number` |  |
| ☐ | `cnr_no` | CNR number | Text | `c.cnr` |  |

### Case tracking

| ✓ | Key | Column | Type | Source | Notes |
|---|---|---|---|---|---|
| ☐ | `case_status` | Case status | Text | `c.status` | Values on SIT: ONGOING, CLOSED |
| ☐ | `stage` | Stage | Text | `c.stage` | Values on SIT: Pre-Notice, Notice, Filing, Court, Closed |
| ☐ | `sub_stage` | Sub stage | Text | `c.substage` |  |
| ☐ | `last_event` | Last event | Text | `c.event` |  |
| ☐ | `reason` | Reason | Text | `c.reason` |  |
| ☐ | `remarks` | Remarks | Text | `c.remarks` |  |
| ☐ | `case_language` | Case language | Text | `c.language` |  |
| ☐ | `advocate` | Assigned advocate | Text | `c.name_of_advocate` |  |
| ☐ | `advocate_designation` | Advocate designation | Text | `c.designation_of_advocate` |  |

### Workflow

| ✓ | Key | Column | Type | Source | Notes |
|---|---|---|---|---|---|
| ☐ | `workflow_status` | Workflow status | Text | `c.workflow_status` |  |
| ☐ | `workflow_stage_key` | Workflow stage | Text | `execution.current_stage_key` | Needs join: execution |
| ☐ | `stage_entry_date` | In current stage since | Date | `execution.stage_entered_at` | Needs join: execution |
| ☐ | `awaiting_input` | Awaiting input | Yes / No | `execution.awaiting_input` | Needs join: execution |
| ☐ | `automation_disabled` | Automation disabled | Yes / No | `c.workflow_automation_disabled` |  |

### Court (eCourts)

| ✓ | Key | Column | Type | Source | Notes |
|---|---|---|---|---|---|
| ☐ | `ecourt_case_status` | eCourts case status | Text | `ecourt.case_status` | Needs join: ecourt |
| ☐ | `ecourt_case_type` | eCourts case type | Text | `ecourt.case_type_display` | Needs join: ecourt |
| ☐ | `ecourt_filing_number` | Filing number | Text | `ecourt.filing_number` | Needs join: ecourt |
| ☐ | `ecourt_filing_date` | eCourts filing date | Date | `ecourt.filing_date` | Needs join: ecourt |
| ☐ | `ecourt_registration_number` | Registration number | Text | `ecourt.registration_number` | Needs join: ecourt |
| ☐ | `ecourt_registration_date` | Registration date | Date | `ecourt.registration_date` | Needs join: ecourt |
| ☐ | `court_and_judge` | Court number and judge | Text | `ecourt.court_number_and_judge` | Needs join: ecourt |
| ☐ | `first_hearing` | First hearing date | Date | `ecourt.first_hearing_date` | Needs join: ecourt |
| ☐ | `next_hearing` | Next hearing date | Date | `ecourt.next_hearing_date` | Needs join: ecourt |
| ☐ | `decision_date` | Decision date | Date | `ecourt.decision_date` | Needs join: ecourt |
| ☐ | `ecourt_synced_at` | eCourts last synced | Date + time | `ecourt.synced_at` | Needs join: ecourt |
| ☐ | `hearing_date` | Hearing date | Date | `x.hearing_date` from `courtbridge.ecourt_case_hearings x` where `x.cnr = c.cnr` (ordered by `x.hearing_date`) | Repeats — user picks latest / first / all / count |
| ☐ | `hearing_purpose` | Hearing purpose | Text | `x.purpose` from `courtbridge.ecourt_case_hearings x` where `x.cnr = c.cnr` (ordered by `x.hearing_date`) | Repeats — user picks latest / first / all / count |

### Proceedings

| ✓ | Key | Column | Type | Source | Notes |
|---|---|---|---|---|---|
| ☐ | `milestone_type` | Milestone | Text | `x.milestone_type` from `cms.proceedings x` where `x.case_id = c.id AND x.case_type = 'section138'` (ordered by `x.milestone_date`) | Repeats — user picks latest / first / all / count |
| ☐ | `milestone_date` | Milestone date | Date | `x.milestone_date` from `cms.proceedings x` where `x.case_id = c.id AND x.case_type = 'section138'` (ordered by `x.milestone_date`) | Repeats — user picks latest / first / all / count |
| ☐ | `milestone_status` | Milestone status | Text | `x.status` from `cms.proceedings x` where `x.case_id = c.id AND x.case_type = 'section138'` (ordered by `x.milestone_date`) | Repeats — user picks latest / first / all / count |
| ☐ | `milestone_remark` | Milestone remark | Text | `x.remark` from `cms.proceedings x` where `x.case_id = c.id AND x.case_type = 'section138'` (ordered by `x.milestone_date`) | Repeats — user picks latest / first / all / count |

### Communication and replies

| ✓ | Key | Column | Type | Source | Notes |
|---|---|---|---|---|---|
| ☐ | `sms_status` | SMS status | Text | `x.status` from `digiserve.communication_request x` where `x.case_id = c.id::text AND x.communication_mode = 'SMS'` (ordered by `x.created_at`) | Repeats — user picks latest / first / all / count |
| ☐ | `sms_sent_at` | SMS sent at | Date + time | `x.sent_at` from `digiserve.communication_request x` where `x.case_id = c.id::text AND x.communication_mode = 'SMS'` (ordered by `x.created_at`) | Repeats — user picks latest / first / all / count |
| ☐ | `email_status` | Email status | Text | `x.status` from `digiserve.communication_request x` where `x.case_id = c.id::text AND x.communication_mode = 'EMAIL'` (ordered by `x.created_at`) | Repeats — user picks latest / first / all / count |
| ☐ | `email_sent_at` | Email sent at | Date + time | `x.sent_at` from `digiserve.communication_request x` where `x.case_id = c.id::text AND x.communication_mode = 'EMAIL'` (ordered by `x.created_at`) | Repeats — user picks latest / first / all / count |
| ☐ | `wa_status` | WhatsApp status | Text | `x.status` from `digiserve.communication_request x` where `x.case_id = c.id::text AND x.communication_mode = 'WHATSAPP'` (ordered by `x.created_at`) | Repeats — user picks latest / first / all / count |
| ☐ | `wa_sent_at` | WhatsApp sent at | Date + time | `x.sent_at` from `digiserve.communication_request x` where `x.case_id = c.id::text AND x.communication_mode = 'WHATSAPP'` (ordered by `x.created_at`) | Repeats — user picks latest / first / all / count |
| ☐ | `reply_received` | Reply received | Yes / No | `EXISTS (SELECT 1 FROM digiserve.reply r WHERE r.case_id = c.id::text)` | Calculated |
| ☐ | `reply_date` | Reply date | Date + time | `x.created_at` from `digiserve.reply x` where `x.case_id = c.id::text` (ordered by `x.created_at`) | Repeats — user picks latest / first / all / count |
| ☐ | `reply_channel` | Channel replied from | Text | `x.communication_mode` from `digiserve.reply x` where `x.case_id = c.id::text` (ordered by `x.created_at`) | Repeats — user picks latest / first / all / count |
| ☐ | `reply_category` | Category of reply | Text | `x.reply_proceeding_type` from `digiserve.reply x` where `x.case_id = c.id::text` (ordered by `x.created_at`) | Repeats — user picks latest / first / all / count |

### Drafts and documents

| ✓ | Key | Column | Type | Source | Notes |
|---|---|---|---|---|---|
| ☐ | `draft_type` | Draft type | Text | `x.draft_type` from `cms.drafts x` where `x.case_id = c.id AND x.case_type = 'section138'` (ordered by `x.created_at`) | Repeats — user picks latest / first / all / count |
| ☐ | `draft_date` | Draft generated date | Date | `x.created_at` from `cms.drafts x` where `x.case_id = c.id AND x.case_type = 'section138'` (ordered by `x.created_at`) | Repeats — user picks latest / first / all / count |
| ☐ | `document_type` | Uploaded document type | Text | `x.doc_type` from `cms.documents x` where `x.case_id = c.id AND x.case_type = 'section138'` (ordered by `x.created_at`) | Repeats — user picks latest / first / all / count |

### Calculated timelines

| ✓ | Key | Column | Type | Source | Notes |
|---|---|---|---|---|---|
| ☐ | `d_memo_notice` | Days: return memo to notice | Number | `(c.notice_date::date - c.return_memo_date::date)` | Calculated |
| ☐ | `d_notice_complaint` | Days: notice to complaint | Number | `(c.case_filing_date::date - c.notice_date::date)` | Calculated |
| ☐ | `notice_breach` | Notice sent after 30-day limit | Yes / No | `(c.notice_date::date > c.return_memo_date::date + 30)` | Calculated. Notice date is more than 30 days after the return memo date |
| ☐ | `days_since_notice` | Days since notice | Number | `(CURRENT_DATE - c.notice_date::date)` | Calculated |
| ☐ | `days_in_stage` | Days in current stage | Number | `(CURRENT_DATE - execution.stage_entered_at::date)` | Calculated. Needs join: execution |
| ☐ | `case_age` | Case age (days) | Number | `(CURRENT_DATE - c.created_at::date)` | Calculated |
| ☐ | `ageing` | Ageing bucket | Pick list | `CASE WHEN (CURRENT_DATE - c.created_at::date) <= 30 THEN '0–30 days' WHEN (CURRENT_DATE - c.created_at::date) <= 90 THEN '31–90 days' WHEN (CURRENT_DATE - c.created_at::date) <= 180 THEN '91–180 days' WHEN (CURRENT_DATE - c.created_at::date) <= 365 THEN '181–365 days' ELSE 'Over 1 year' END` | Calculated. Options: 0–30 days, 31–90 days, 91–180 days, 181–365 days, Over 1 year |

### Joins (lookups)

Added to the query only when a chosen column or filter needs them.

**respondent** — Primary respondent (borrower) from cms.litigants

```sql
LEFT JOIN LATERAL (
    SELECT l.* FROM cms.litigants l
    WHERE l.case_id = c.id AND l.case_type = 'section138' AND l.is_primary_respondent
    ORDER BY l.id
    LIMIT 1
  ) respondent ON true
```

**respondentAddress** — Latest address of the primary respondent

```sql
LEFT JOIN LATERAL (
    SELECT a.address, a.pincode FROM cms.litigant_addresses a
    WHERE a.litigant_id = respondent.id
    ORDER BY a.id DESC
    LIMIT 1
  ) respondent_address ON true
```

**execution** — Workflow execution of the case

```sql
LEFT JOIN workflow.executions execution ON execution.id = c.workflow_execution_id
```

**ecourt** — eCourts record matched on CNR

```sql
LEFT JOIN courtbridge.ecourt_cases ecourt ON ecourt.cnr = c.cnr
```

## Section 25 (`section25`)

**Not available yet.** Base table not confirmed. To switch it on, set `baseTable` in `backend/config/workflows.js` and add its groups in `backend/config/column-catalog.js`.

## SARFAESI (`sarfaesi`)

**Not available yet.** Base table not confirmed. To switch it on, set `baseTable` in `backend/config/workflows.js` and add its groups in `backend/config/column-catalog.js`.

## In the prototype but not in the database yet

These appear in `litelo-reports-v2.html` but no table/column was found for them in `LITELO_CONTEXT.md`.
Each needs either a column added to the platform or a pointer to where it is stored (often inside a `meta` / JSON column).

| Group | Columns |
|---|---|
| Case and batch | Batch ID, Loan account number (if different from Agreement number) |
| Borrower | Preferred language |
| Claimant | Authorised representative, Representative email |
| Loan | Product, Sanctioned amount, EMI amount, DPD, Principal outstanding |
| Location | Branch, Zone, State, City, Pincode (of the loan / branch) |
| Cheque | Cheque amount, Drawer branch, Presenting (payee) branch, Cheque purpose |
| Dishonour | Number of presentations, Dishonour date, Memo received date |
| Demand notice | Notice language, Dispatch mode, Tracking / POD number, Courier dispatch date, Delivery status, Notice served date, Reason of undelivery, Payment due by, Paid within notice period |
| Complaint filing | Cause of action date, Complaint limitation date, Filing status, Court city, Cognizance date |
| Proceedings | Summons issued/status, Reissue summons, Warrant type/date/status, Proclaimed offender, First appearance, Interim compensation (143A), Lok Adalat / mediation |
| Judgment | Judgment date and outcome, Compensation awarded, Withdrawal date/status, Appeal filed/status |
| Communication and replies | Reply link opened, Full reply text, Supporting document (likely inside `digiserve.reply.reply_data` JSON) |
| Settlement and recovery | Whole group: settlement status/amount, payment date, total recovered, closure date/reason |
| Legal cost | Whole group: advocate fee, court fee, notice cost, total cost, invoice status |
| Calculated timelines | Complaint filed after limitation, Limitation status (need limitation date first) |
