/**
 * SCREEN 2 — Report builder. Four numbered steps on the left; on the right a sticky panel with
 * the plain-language summary, a sample-data preview, any save errors, and Save / Cancel.
 *
 * Validation happens on the server (one set of rules); its error list is shown here as-is.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { misApi } from '../../services/mis-api';
import { useMis, EnterpriseSelect, WorkflowSwitch, DataTable, ErrorList, ReportSentence } from './ui';
import { sampleTable } from './sample-data';
import ColumnPicker from './ColumnPicker';
import FilterEditor from './FilterEditor';

function Step({ number, title, hint, children }) {
  return (
    <section className="sec">
      <div className="sh">
        <span className="step">{number}</span>
        <div>
          <h3>{title}</h3>
          <p className="xs">{hint}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

// <select> of the fields that can be a date basis, grouped.
function DateBasisSelect({ fields, value, onChange }) {
  const dateFields = fields.filter((f) => f.canBeDateBasis);
  const groups = [...new Set(dateFields.map((f) => f.group))];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Date field">
      <option value="">Choose a date field</option>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {dateFields.filter((f) => f.group === g).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

export default function ReportBuilder({ initial, onCancel, onSaved }) {
  const { enterpriseName, workflowLabel, confirm } = useMis();
  const [draft, setDraft] = useState(initial);
  const [fields, setFields] = useState([]);
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const isNew = !initial.id;

  useEffect(() => {
    misApi.getCatalog(draft.workflow).then(setFields).catch((err) => setErrors([err.message]));
  }, [draft.workflow]);

  const fieldsByKey = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, f])), [fields]);
  const sample = useMemo(() => sampleTable(draft.columns, fieldsByKey), [draft.columns, fieldsByKey]);
  const set = (changes) => setDraft((d) => ({ ...d, ...changes }));

  // Each workflow has its own fields, so switching clears columns and filters (after asking).
  const changeWorkflow = async (workflow) => {
    if (workflow === draft.workflow) return;
    if (draft.columns.length || draft.filters.length) {
      const yes = await confirm({
        title: 'Switch workflow?',
        body: `Moving to ${workflowLabel(workflow)} clears the columns and filters you have picked, because each workflow has its own fields.`,
        label: 'Switch',
        danger: true,
      });
      if (!yes) return;
    }
    set({ workflow, dateBasis: '', columns: [], filters: [] });
  };

  const save = async () => {
    setSaving(true);
    setErrors([]);
    try {
      const saved = isNew ? await misApi.createTemplate(draft) : await misApi.updateTemplate(draft.id, draft);
      onSaved(saved);
    } catch (err) {
      setErrors(err.errors && err.errors.length ? err.errors : [err.message]);
    } finally {
      setSaving(false);
    }
  };

  const dateField = fieldsByKey[draft.dateBasis];

  return (
    <>
      <button className="btn gh sm" onClick={onCancel} style={{ marginBottom: 10 }}>← All report templates</button>
      <div className="ph">
        <div>
          <h1>{isNew ? 'New report' : 'Edit report'}</h1>
          <p className="mut sm">
            {enterpriseName(draft.enterpriseId)} · {workflowLabel(draft.workflow)}. Changes apply the next time this report is run.
          </p>
        </div>
      </div>

      <div className="bl">
        <div className="panel">
          <Step number={1} title="Report details" hint="The enterprise sees the name and description when choosing a report.">
            <label className="fld">
              <span>Report name</span>
              <input type="text" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Notice dispatch tracker" />
            </label>
            <label className="fld">
              <span>Description</span>
              <textarea value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="What this report is for and who reads it" />
            </label>
            <div className="row">
              <EnterpriseSelect className="fld" value={draft.enterpriseId} onChange={(enterpriseId) => set({ enterpriseId })} />
              <label className="fld">
                <span>Status</span>
                <select value={draft.status} onChange={(e) => set({ status: e.target.value })}>
                  <option>Active</option>
                  <option>Draft</option>
                </select>
                <p className="hint">Draft reports stay hidden from the enterprise.</p>
              </label>
            </div>
            <div className="fld" style={{ marginBottom: 0 }}>
              <span>Workflow</span>
              <WorkflowSwitch value={draft.workflow} onChange={changeWorkflow} />
              <p className="hint">One report reads one workflow. Switching clears the columns and filters below.</p>
            </div>
          </Step>

          <Step number={2} title="Date range applies to" hint="When the enterprise picks dates, this is the field those dates are matched against.">
            <DateBasisSelect fields={fields} value={draft.dateBasis} onChange={(dateBasis) => set({ dateBasis })} />
            <p className="hint">
              {dateField && dateField.type === 'datetime'
                ? 'Cases are matched on the day of this date and time, in Indian time.'
                : 'Cases where this date is empty are left out. Batches are not selected separately — every case in range is included.'}
            </p>
          </Step>

          <Step number={3} title="Columns" hint="Tick fields on the left. Rename headers and set the export order on the right.">
            {fields.length ? (
              <ColumnPicker fields={fields} fieldsByKey={fieldsByKey} columns={draft.columns} onChange={(columns) => set({ columns })} />
            ) : (
              <p className="xs">No columns are set up for {workflowLabel(draft.workflow)} yet.</p>
            )}
          </Step>

          <Step number={4} title="Fixed filters" hint="Always applied. The enterprise cannot change these, so use them to keep a report focused.">
            <FilterEditor fields={fields} fieldsByKey={fieldsByKey} filters={draft.filters} onChange={(filters) => set({ filters })} />
          </Step>
        </div>

        <aside className="side">
          <div className="panel pad">
            <h3 style={{ marginBottom: 9 }}>What this report does</h3>
            <p className="sent">
              <ReportSentence template={draft} fieldsByKey={fieldsByKey} enterpriseName={enterpriseName(draft.enterpriseId)} />
            </p>
          </div>
          <div className="panel pad pv">
            <h3 style={{ marginBottom: 9 }}>Preview <span className="xs">sample data</span></h3>
            <DataTable columns={sample.columns} rows={sample.rows} emptyText="Add columns to see a preview." showTotal />
          </div>
          <ErrorList errors={errors} />
          <div className="acts">
            <button className="btn" onClick={onCancel}>Cancel</button>
            <button className="btn primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : isNew ? 'Save report' : 'Save changes'}
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}
