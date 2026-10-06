/**
 * The workflows a report can be built on. One report reads exactly one workflow.
 *
 *   baseTable — the table with one row per case. Every report query starts `FROM <baseTable> c`.
 *   caseType  — the value the shared cms tables (litigants, proceedings, drafts...) store in `case_type`.
 *
 * A workflow whose baseTable is null shows in the UI but has no columns yet.
 * To switch one on: set baseTable, then add its field groups in column-catalog.js.
 */

const WORKFLOWS = {
  section138: { label: 'Section 138', baseTable: 'cms.cheque', caseType: 'section138' }, // confirmed on SIT
  section25: { label: 'Section 25', baseTable: null, caseType: 'eft' },
  sarfaesi: { label: 'SARFAESI', baseTable: null, caseType: 'sarfaesi' },
};

function getWorkflow(key) {
  return WORKFLOWS[key] || null;
}

function listWorkflows() {
  return Object.entries(WORKFLOWS).map(([key, wf]) => ({
    key,
    label: wf.label,
    available: Boolean(wf.baseTable),
  }));
}

module.exports = { WORKFLOWS, getWorkflow, listWorkflows };
