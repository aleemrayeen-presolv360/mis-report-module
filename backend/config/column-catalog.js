/**
 * COLUMN CATALOG — every column a user can put in a report, per workflow.
 *
 * Every report query looks like:
 *
 *     SELECT <one expression per column>
 *     FROM <workflow base table> c          <- one row per case, alias is always `c`
 *     <LEFT JOIN LATERAL lookups>           <- only the lookups the chosen columns need
 *     WHERE c.enterprise_id = ... AND <date basis in range> AND <fixed filters>
 *
 * There are two kinds of field:
 *
 *   one(...)   One value per case. `sql` is an expression on `c` or on a lookup alias.
 *              If it uses a lookup, list it in `needs` so the join is added.
 *
 *   many(...)  Several values per case (messages, hearings, replies...). It is read with a
 *              correlated sub-query, so a case never turns into several rows. The user picks
 *              what the column shows: latest, first, all values joined, or a count.
 *
 * Field types: text | enum | number | amount | date | datetime | boolean
 *   - `enum` needs `options` (shown as a pick list in filters).
 *   - `date` columns are written as real dates in Excel; `datetime` keeps the time too.
 *
 * SAFETY: SQL in this file is written by developers and never contains user input.
 * User input (dates, filter values) is always passed as $1, $2... parameters by query-builder.js.
 *
 * Run `npm run docs:columns` after changing this file to refresh LITELO_COLUMNS.md.
 */

const { WORKFLOWS } = require('./workflows');

const one = (key, label, type, sql, extra = {}) => ({ key, label, type, sql, needs: [], ...extra });
const many = (key, label, type, source, extra = {}) => ({ key, label, type, repeating: source, needs: [], ...extra });

/* ------------------------------------------------------------------ */
/* Lookups: 1-to-1 joins. Each one adds at most one row per case.     */
/* ------------------------------------------------------------------ */

function caseLookups(caseType) {
  return {
    respondent: {
      description: 'Primary respondent (borrower) from cms.litigants',
      sql: `LEFT JOIN LATERAL (
    SELECT l.* FROM cms.litigants l
    WHERE l.case_id = c.id AND l.case_type = '${caseType}' AND l.is_primary_respondent
    ORDER BY l.id
    LIMIT 1
  ) respondent ON true`,
    },
    respondentAddress: {
      description: 'Latest address of the primary respondent',
      needs: ['respondent'],
      sql: `LEFT JOIN LATERAL (
    SELECT a.address, a.pincode FROM cms.litigant_addresses a
    WHERE a.litigant_id = respondent.id
    ORDER BY a.id DESC
    LIMIT 1
  ) respondent_address ON true`,
    },
    execution: {
      description: 'Workflow execution of the case',
      sql: 'LEFT JOIN workflow.executions execution ON execution.id = c.workflow_execution_id',
    },
    ecourt: {
      description: 'eCourts record matched on CNR',
      sql: 'LEFT JOIN courtbridge.ecourt_cases ecourt ON ecourt.cnr = c.cnr',
    },
  };
}

/* ------------------------------------------------------------------ */
/* Sources for repeating fields                                        */
/* ------------------------------------------------------------------ */

const communicationsByMode = (mode) => ({
  from: 'digiserve.communication_request x',
  where: `x.case_id = c.id::text AND x.communication_mode = '${mode}'`,
  orderBy: 'x.created_at',
});

const replies = () => ({
  from: 'digiserve.reply x',
  where: 'x.case_id = c.id::text',
  orderBy: 'x.created_at',
});

const proceedings = (caseType) => ({
  from: 'cms.proceedings x',
  where: `x.case_id = c.id AND x.case_type = '${caseType}'`,
  orderBy: 'x.milestone_date',
});

const drafts = (caseType) => ({
  from: 'cms.drafts x',
  where: `x.case_id = c.id AND x.case_type = '${caseType}'`,
  orderBy: 'x.created_at',
});

const documents = (caseType) => ({
  from: 'cms.documents x',
  where: `x.case_id = c.id AND x.case_type = '${caseType}'`,
  orderBy: 'x.created_at',
});

const hearings = () => ({
  from: 'courtbridge.ecourt_case_hearings x',
  where: 'x.cnr = c.cnr',
  orderBy: 'x.hearing_date',
});

const otherRespondents = (caseType) => ({
  from: 'cms.litigants x',
  where: `x.case_id = c.id AND x.case_type = '${caseType}' AND x.role = 'respondent' AND x.is_primary_respondent IS NOT TRUE`,
  orderBy: 'x.id',
});

/* ------------------------------------------------------------------ */
/* Field groups shared by every workflow that uses the common cms tables */
/* ------------------------------------------------------------------ */

const borrowerGroup = (caseType) => ({
  group: 'Borrower',
  fields: [
    one('borrower_name', 'Borrower name', 'text', 'respondent.full_name', { needs: ['respondent'] }),
    one('borrower_father_name', 'Father name', 'text', 'respondent.father_name', { needs: ['respondent'] }),
    one('borrower_email', 'Email', 'text', 'respondent.email', { needs: ['respondent'] }),
    // contact JSON on SIT looks like {"mobile": ["98..."], "whatsapp": []}; all numbers are joined with ", "
    one('borrower_mobile', 'Mobile', 'text', `array_to_string(ARRAY(SELECT jsonb_array_elements_text(respondent.contact->'mobile')), ', ')`, {
      needs: ['respondent'],
    }),
    one('borrower_whatsapp', 'WhatsApp number', 'text', `array_to_string(ARRAY(SELECT jsonb_array_elements_text(respondent.contact->'whatsapp')), ', ')`, {
      needs: ['respondent'],
    }),
    one('borrower_status', 'Borrower status', 'text', 'respondent.respondent_status', { needs: ['respondent'] }),
    one('borrower_address', 'Full address', 'text', 'respondent_address.address', { needs: ['respondentAddress'] }),
    one('borrower_pincode', 'Pincode', 'text', 'respondent_address.pincode', { needs: ['respondentAddress'] }),
    many('co_borrower', 'Co-borrower / guarantor', 'text', { ...otherRespondents(caseType), value: 'x.full_name' }),
  ],
});

const workflowGroup = () => ({
  group: 'Workflow',
  fields: [
    one('workflow_status', 'Workflow status', 'text', 'c.workflow_status'),
    one('workflow_stage_key', 'Workflow stage', 'text', 'execution.current_stage_key', { needs: ['execution'] }),
    one('stage_entry_date', 'In current stage since', 'date', 'execution.stage_entered_at', { needs: ['execution'] }),
    one('awaiting_input', 'Awaiting input', 'boolean', 'execution.awaiting_input', { needs: ['execution'] }),
    one('automation_disabled', 'Automation disabled', 'boolean', 'c.workflow_automation_disabled'),
  ],
});

const courtGroup = () => ({
  group: 'Court (eCourts)',
  fields: [
    one('ecourt_case_status', 'eCourts case status', 'text', 'ecourt.case_status', { needs: ['ecourt'] }),
    one('ecourt_case_type', 'eCourts case type', 'text', 'ecourt.case_type_display', { needs: ['ecourt'] }),
    one('ecourt_filing_number', 'Filing number', 'text', 'ecourt.filing_number', { needs: ['ecourt'] }),
    one('ecourt_filing_date', 'eCourts filing date', 'date', 'ecourt.filing_date', { needs: ['ecourt'] }),
    one('ecourt_registration_number', 'Registration number', 'text', 'ecourt.registration_number', { needs: ['ecourt'] }),
    one('ecourt_registration_date', 'Registration date', 'date', 'ecourt.registration_date', { needs: ['ecourt'] }),
    one('court_and_judge', 'Court number and judge', 'text', 'ecourt.court_number_and_judge', { needs: ['ecourt'] }),
    one('first_hearing', 'First hearing date', 'date', 'ecourt.first_hearing_date', { needs: ['ecourt'] }),
    one('next_hearing', 'Next hearing date', 'date', 'ecourt.next_hearing_date', { needs: ['ecourt'] }),
    one('decision_date', 'Decision date', 'date', 'ecourt.decision_date', { needs: ['ecourt'] }),
    one('ecourt_synced_at', 'eCourts last synced', 'datetime', 'ecourt.synced_at', { needs: ['ecourt'] }),
    many('hearing_date', 'Hearing date', 'date', { ...hearings(), value: 'x.hearing_date' }),
    many('hearing_purpose', 'Hearing purpose', 'text', { ...hearings(), value: 'x.purpose' }),
  ],
});

const proceedingsGroup = (caseType) => ({
  group: 'Proceedings',
  fields: [
    many('milestone_type', 'Milestone', 'text', { ...proceedings(caseType), value: 'x.milestone_type' }),
    many('milestone_date', 'Milestone date', 'date', { ...proceedings(caseType), value: 'x.milestone_date' }),
    many('milestone_status', 'Milestone status', 'text', { ...proceedings(caseType), value: 'x.status' }),
    many('milestone_remark', 'Milestone remark', 'text', { ...proceedings(caseType), value: 'x.remark' }),
  ],
});

const communicationGroup = () => ({
  group: 'Communication and replies',
  fields: [
    // communication_mode values on SIT are upper case: SMS, EMAIL, WHATSAPP
    many('sms_status', 'SMS status', 'text', { ...communicationsByMode('SMS'), value: 'x.status' }),
    many('sms_sent_at', 'SMS sent at', 'datetime', { ...communicationsByMode('SMS'), value: 'x.sent_at' }),
    many('email_status', 'Email status', 'text', { ...communicationsByMode('EMAIL'), value: 'x.status' }),
    many('email_sent_at', 'Email sent at', 'datetime', { ...communicationsByMode('EMAIL'), value: 'x.sent_at' }),
    many('wa_status', 'WhatsApp status', 'text', { ...communicationsByMode('WHATSAPP'), value: 'x.status' }),
    many('wa_sent_at', 'WhatsApp sent at', 'datetime', { ...communicationsByMode('WHATSAPP'), value: 'x.sent_at' }),
    one('reply_received', 'Reply received', 'boolean', 'EXISTS (SELECT 1 FROM digiserve.reply r WHERE r.case_id = c.id::text)', {
      calculated: true,
    }),
    many('reply_date', 'Reply date', 'datetime', { ...replies(), value: 'x.created_at' }),
    many('reply_channel', 'Channel replied from', 'text', { ...replies(), value: 'x.communication_mode' }),
    many('reply_category', 'Category of reply', 'text', { ...replies(), value: 'x.reply_proceeding_type' }),
  ],
});

const documentsGroup = (caseType) => ({
  group: 'Drafts and documents',
  fields: [
    many('draft_type', 'Draft type', 'text', { ...drafts(caseType), value: 'x.draft_type' }),
    many('draft_date', 'Draft generated date', 'date', { ...drafts(caseType), value: 'x.created_at' }),
    many('document_type', 'Uploaded document type', 'text', { ...documents(caseType), value: 'x.doc_type' }),
  ],
});

/* ------------------------------------------------------------------ */
/* Section 138 (cms.cheque)                                            */
/* ------------------------------------------------------------------ */

const AGEING_BUCKETS = ['0–30 days', '31–90 days', '91–180 days', '181–365 days', 'Over 1 year'];
const CASE_AGE_SQL = '(CURRENT_DATE - c.created_at::date)';

function section138Groups() {
  const caseType = WORKFLOWS.section138.caseType;
  return [
    {
      group: 'Case and batch',
      fields: [
        one('case_number', 'Case number', 'text', 'c.case_number'),
        one('ref_number', 'Reference number', 'text', 'c.ref_number'),
        one('agreement_number', 'Agreement number', 'text', 'c.agreement_number'),
        one('file_number', 'File number', 'text', 'c.file_number'),
        one('case_created_date', 'Case created date', 'date', 'c.created_at'),
        one('case_updated_date', 'Case last updated', 'date', 'c.updated_at'),
      ],
    },
    borrowerGroup(caseType),
    {
      group: 'Claimant',
      fields: [
        one('claimant_name', 'Claimant name', 'text', 'c.client_name'),
        one('claimant_address', 'Claimant registered address', 'text', 'c.client_registered_office'),
        one('claimant_contact', 'Claimant contact person', 'text', 'c.contact_person_for_claimant'),
      ],
    },
    {
      group: 'Loan',
      fields: [
        one('nature_of_agreement', 'Nature of agreement', 'text', 'c.nature_of_agreement'),
        one('loan_amount', 'Loan amount', 'amount', 'c.loan_amount'),
        one('outstanding_amount', 'Total outstanding', 'amount', 'c.outstanding_amount'),
        one('disbursal_date', 'Disbursal date', 'date', 'c.disbursal_date'),
      ],
    },
    {
      group: 'Cheque',
      fields: [
        one('cheque_no', 'Cheque number', 'text', 'c.cheque_number'),
        one('cheque_date', 'Cheque date', 'date', 'c.cheque_date'),
        one('drawer_bank', 'Drawer bank and branch', 'text', 'c.bank_name_branch'),
        one('drawer_account', 'Drawer account number', 'text', 'c.account_number'),
      ],
    },
    {
      group: 'Dishonour',
      fields: [
        one('presentation_date', 'Presentation date', 'date', 'c.presentation_date'),
        one('return_reason', 'Bounce reason', 'text', 'c.cheque_bounce_reason'),
        one('memo_no', 'Memo number', 'text', 'c.bounce_memo_reference'),
        one('memo_date', 'Return memo date', 'date', 'c.return_memo_date', {
          description: 'Starts the 30-day notice window',
        }),
      ],
    },
    {
      group: 'Demand notice',
      fields: [
        one('notice_id', 'Notice ID', 'text', 'c.notice_id'),
        one('notice_due_by', 'Notice due by', 'date', 'c.notice_due_date'),
        one('notice_date', 'Notice date', 'date', 'c.notice_date'),
      ],
    },
    {
      group: 'Complaint filing',
      fields: [
        one('filing_date', 'Complaint filing date', 'date', 'c.case_filing_date'),
        one('court_name', 'Court', 'text', 'c.court_name'),
        one('jurisdiction', 'Jurisdiction', 'text', 'c.jurisdiction'),
        one('complaint_no', 'Complaint (CC) number', 'text', 'c.court_case_number'),
        one('cnr_no', 'CNR number', 'text', 'c.cnr'),
      ],
    },
    {
      group: 'Case tracking',
      fields: [
        one('case_status', 'Case status', 'text', 'c.status', { description: 'Values on SIT: ONGOING, CLOSED' }),
        one('stage', 'Stage', 'text', 'c.stage', { description: 'Values on SIT: Pre-Notice, Notice, Filing, Court, Closed' }),
        one('sub_stage', 'Sub stage', 'text', 'c.substage'),
        one('last_event', 'Last event', 'text', 'c.event'),
        one('reason', 'Reason', 'text', 'c.reason'),
        one('remarks', 'Remarks', 'text', 'c.remarks'),
        one('case_language', 'Case language', 'text', 'c.language'),
        one('advocate', 'Assigned advocate', 'text', 'c.name_of_advocate'),
        one('advocate_designation', 'Advocate designation', 'text', 'c.designation_of_advocate'),
      ],
    },
    workflowGroup(),
    courtGroup(),
    proceedingsGroup(caseType),
    communicationGroup(),
    documentsGroup(caseType),
    {
      group: 'Calculated timelines',
      fields: [
        one('d_memo_notice', 'Days: return memo to notice', 'number', '(c.notice_date::date - c.return_memo_date::date)', {
          calculated: true,
        }),
        one('d_notice_complaint', 'Days: notice to complaint', 'number', '(c.case_filing_date::date - c.notice_date::date)', {
          calculated: true,
        }),
        one('notice_breach', 'Notice sent after 30-day limit', 'boolean', '(c.notice_date::date > c.return_memo_date::date + 30)', {
          calculated: true,
          description: 'Notice date is more than 30 days after the return memo date',
        }),
        one('days_since_notice', 'Days since notice', 'number', '(CURRENT_DATE - c.notice_date::date)', { calculated: true }),
        one('days_in_stage', 'Days in current stage', 'number', '(CURRENT_DATE - execution.stage_entered_at::date)', {
          calculated: true,
          needs: ['execution'],
        }),
        one('case_age', 'Case age (days)', 'number', CASE_AGE_SQL, { calculated: true }),
        one(
          'ageing',
          'Ageing bucket',
          'enum',
          `CASE
      WHEN ${CASE_AGE_SQL} <= 30 THEN '${AGEING_BUCKETS[0]}'
      WHEN ${CASE_AGE_SQL} <= 90 THEN '${AGEING_BUCKETS[1]}'
      WHEN ${CASE_AGE_SQL} <= 180 THEN '${AGEING_BUCKETS[2]}'
      WHEN ${CASE_AGE_SQL} <= 365 THEN '${AGEING_BUCKETS[3]}'
      ELSE '${AGEING_BUCKETS[4]}'
    END`,
          { calculated: true, options: AGEING_BUCKETS }
        ),
      ],
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Build the lookup tables used by the rest of the code                */
/* ------------------------------------------------------------------ */

const GROUPS_BY_WORKFLOW = {
  section138: section138Groups,
  // section25: section25Groups,   <- add when the EFT base table is confirmed
  // sarfaesi: sarfaesiGroups,     <- add when the SARFAESI base table is confirmed
};

function compileCatalog(workflowKey) {
  const workflow = WORKFLOWS[workflowKey];
  const buildGroups = GROUPS_BY_WORKFLOW[workflowKey];
  if (!workflow.baseTable || !buildGroups) {
    return { fields: [], fieldsByKey: {}, lookups: {} };
  }

  const lookups = caseLookups(workflow.caseType);
  const fields = [];
  const fieldsByKey = {};

  for (const { group, fields: groupFields } of buildGroups()) {
    for (const field of groupFields) {
      if (fieldsByKey[field.key]) throw new Error(`Duplicate column key "${field.key}" in ${workflowKey} catalog`);
      for (const name of field.needs) {
        if (!lookups[name]) throw new Error(`Column "${field.key}" needs unknown lookup "${name}"`);
      }
      const compiled = { ...field, group };
      fields.push(compiled);
      fieldsByKey[field.key] = compiled;
    }
  }
  return { fields, fieldsByKey, lookups };
}

// Built once at startup. A typo in the catalog stops the server here instead of failing on a client's report.
const CATALOGS = Object.fromEntries(Object.keys(WORKFLOWS).map((key) => [key, compileCatalog(key)]));

function getCatalog(workflowKey) {
  return CATALOGS[workflowKey] || null;
}

function getField(workflowKey, fieldKey) {
  const catalog = getCatalog(workflowKey);
  return (catalog && catalog.fieldsByKey[fieldKey]) || null;
}

// A field can be the date basis if it is a single date per case (repeating dates are ambiguous).
function canBeDateBasis(field) {
  return (field.type === 'date' || field.type === 'datetime') && !field.repeating;
}

// What the browser receives: no SQL, just what the builder UI needs.
function toPublicField(field) {
  return {
    key: field.key,
    label: field.label,
    type: field.type,
    group: field.group,
    description: field.description || '',
    options: field.options || null,
    repeating: Boolean(field.repeating),
    calculated: Boolean(field.calculated),
    canBeDateBasis: canBeDateBasis(field),
  };
}

function getPublicFields(workflowKey) {
  const catalog = getCatalog(workflowKey);
  return catalog ? catalog.fields.map(toPublicField) : [];
}

module.exports = { getCatalog, getField, getPublicFields, canBeDateBasis };
