/**
 * Small building blocks shared by the Report screens.
 * Markup and class names match litelo-reports-v2.html so the styles apply unchanged.
 */

import React, { createContext, useContext, useEffect } from 'react';
import { formatCell, formatDate, formatInr, isNumericType } from './format';

/* ------------------------------------------------------------------ */
/* Shared context: config, enterprises, toast and confirm              */
/* ------------------------------------------------------------------ */

// Provided by MISReport: { config, enterprises, enterpriseName(id), workflowLabel(key), toast(msg), confirm(opts) }
export const MisContext = createContext(null);
export const useMis = () => useContext(MisContext);

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

export function Modal({ onClose, children, label }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="ov open" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

// Rendered by MISReport when someone calls confirm({ title, body, label, danger }).
export function ConfirmDialog({ title, body, label, danger, onAnswer }) {
  return (
    <Modal onClose={() => onAnswer(false)} label={title}>
      <h2>{title}</h2>
      <p className="mut sm" style={{ margin: '6px 0 20px' }}>{body}</p>
      <div className="macts">
        <button className="btn" onClick={() => onAnswer(false)}>Cancel</button>
        <button className={`btn ${danger ? 'red' : 'primary'}`} onClick={() => onAnswer(true)} autoFocus>
          {label}
        </button>
      </div>
    </Modal>
  );
}

export function Toast({ message }) {
  return (
    <div className={`toast${message ? ' show' : ''}`} role="status" aria-live="polite">
      {message}
    </div>
  );
}

export function ErrorList({ title = 'Fix these before saving', errors }) {
  if (!errors || !errors.length) return null;
  return (
    <div className="errs" role="alert">
      <strong>{title}</strong>
      <ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Filter bar controls                                                 */
/* ------------------------------------------------------------------ */

// className "fg" = filter bar style (default), "fld" = form field style inside the builder.
export function EnterpriseSelect({ value, onChange, className = 'fg' }) {
  const { enterprises } = useMis();
  return (
    <label className={className}>
      <span>Enterprise</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {enterprises.map((ent) => <option key={ent.id} value={ent.id}>{ent.name}</option>)}
      </select>
    </label>
  );
}

export function WorkflowSwitch({ value, onChange }) {
  const { config } = useMis();
  return (
    <div className="seg" role="group" aria-label="Workflow">
      {config.workflows.map((wf) => (
        <button key={wf.key} type="button" aria-pressed={value === wf.key} onClick={() => onChange(wf.key)}>
          {wf.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Data table (builder sample preview and real report preview)         */
/* ------------------------------------------------------------------ */

/**
 * columns: [{ label, type }]   rows: arrays of raw values in column order
 * showTotal: adds the "Total (n cases)" row with amount sums, as in the prototype's sample preview.
 */
export function DataTable({ columns, rows, emptyText, showTotal = false }) {
  if (!columns.length) return <p className="sm mut" style={{ padding: '10px 0' }}>{emptyText}</p>;
  const numeric = columns.map((c) => isNumericType(c.type));

  const totals = showTotal
    ? columns.map((c, j) => {
        if (j === 0) return `Total (${rows.length} cases)`;
        if (c.type !== 'amount') return '';
        return formatInr(rows.reduce((sum, row) => sum + (Number(row[j]) || 0), 0));
      })
    : null;

  return (
    <div className="tw">
      <table>
        <thead>
          <tr>{columns.map((c, j) => <th key={j} className={numeric[j] ? 'n' : ''}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((value, j) => (
                <td key={j} className={numeric[j] ? 'n' : ''}>{formatCell(value, columns[j].type)}</td>
              ))}
            </tr>
          ))}
          {totals && (
            <tr className="tot">{totals.map((v, j) => <td key={j} className={numeric[j] ? 'n' : ''}>{v}</td>)}</tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* "What this report does" sentence                                    */
/* ------------------------------------------------------------------ */

const Highlight = ({ children, missing }) => <span className={`v${missing ? ' miss' : ''}`}>{children}</span>;

// One fixed filter in plain words, e.g. "case status is any of Open". Returns null if incomplete.
export function describeFilter(field, filter, operators) {
  if (!field) return null;
  const op = operators.find((o) => o.key === filter.op) || operators[0];
  if (!op) return null;
  const name = field.label.toLowerCase();

  if (['empty', 'notempty', 'yes', 'no'].includes(op.key)) return `${name} ${op.label}`;

  let value = filter.value;
  if (Array.isArray(value)) {
    if (!value.length) return null;
    value = value.join(' or ');
  }
  if (value === '' || value === null || value === undefined) return null;
  if (op.key === 'lastn' || op.key === 'nextn') return `${name} is in the ${op.key === 'lastn' ? 'last' : 'next'} ${value} days`;
  if (field.type === 'date' || field.type === 'datetime') value = formatDate(value);
  if (field.type === 'amount') value = formatInr(value);
  return `${name} ${op.label} ${value}`;
}

/**
 * template: { workflow, dateBasis, columns, filters }
 * fieldsByKey: catalog fields for the template's workflow
 * rangeText: e.g. "01 Oct 2026 and 05 Oct 2026", or omitted in the builder
 */
export function ReportSentence({ template, fieldsByKey, enterpriseName, rangeText }) {
  const { workflowLabel, operatorsFor } = useMis();
  const dateField = fieldsByKey[template.dateBasis];
  const filters = template.filters
    .map((f) => describeFilter(fieldsByKey[f.key], f, operatorsFor(fieldsByKey[f.key])))
    .filter(Boolean);
  const n = template.columns.length;

  return (
    <>
      One row per case from <Highlight>{workflowLabel(template.workflow)}</Highlight> for{' '}
      <Highlight>{enterpriseName}</Highlight>, where{' '}
      {dateField ? <Highlight>{dateField.label}</Highlight> : <Highlight missing>a date field</Highlight>} falls{' '}
      {rangeText ? <>between <Highlight>{rangeText}</Highlight></> : 'in the range the user picks'}
      {filters.map((text, i) => (
        <React.Fragment key={i}>, and <Highlight>{text}</Highlight></React.Fragment>
      ))}
      .{' '}
      {n ? (
        <>It shows <Highlight>{n === 1 ? '1 column' : `${n} columns`}</Highlight>, newest first.</>
      ) : (
        <>It has <Highlight missing>no columns yet</Highlight>.</>
      )}
    </>
  );
}
