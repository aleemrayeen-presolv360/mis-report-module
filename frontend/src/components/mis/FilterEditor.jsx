/**
 * Builder step 4 — fixed filters. Each row is field · condition · value.
 * Conditions come from the backend (GET /config), so they always match what the SQL supports.
 */

import React from 'react';
import { useMis, describeFilter } from './ui';

// <select> of fields grouped by their catalog group.
function FieldSelect({ fields, value, onChange }) {
  const groups = [...new Set(fields.map((f) => f.group))];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Field">
      <option value="">Choose field</option>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {fields.filter((f) => f.group === g).map((f) => (
            <option key={f.key} value={f.key}>{f.label}{f.repeating ? ' (repeats)' : ''}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function ValueInput({ field, filter, onChange, isNoValueOperator }) {
  if (!field || isNoValueOperator(filter.op)) return <span />;

  if (field.type === 'enum') {
    const chosen = Array.isArray(filter.value) ? filter.value : [];
    return (
      <select multiple size={1} style={{ minHeight: 34 }} value={chosen}
        onChange={(e) => onChange([...e.target.selectedOptions].map((o) => o.value))}>
        {(field.options || []).map((o) => <option key={o}>{o}</option>)}
      </select>
    );
  }
  const value = filter.value ?? ''; // saved filters may hold null or a number
  if (filter.op === 'lastn' || filter.op === 'nextn') {
    return <input type="number" min="1" placeholder="Days" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  if (field.type === 'date' || field.type === 'datetime') {
    return <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  if (field.type === 'amount' || field.type === 'number') {
    return <input type="number" placeholder="Value" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  return <input type="text" placeholder="Value" value={value} onChange={(e) => onChange(e.target.value)} />;
}

export default function FilterEditor({ fields, fieldsByKey, filters, onChange }) {
  const { operatorsFor, isNoValueOperator } = useMis();

  const update = (index, changes) => onChange(filters.map((f, i) => (i === index ? { ...f, ...changes } : f)));

  // A new field resets the condition to that field type's first one.
  const changeField = (index, key) => {
    const field = fieldsByKey[key];
    const firstOp = operatorsFor(field)[0];
    update(index, { key, op: firstOp ? firstOp.key : '', value: field && field.type === 'enum' ? [] : '' });
  };

  const changeOperator = (index, op) => update(index, isNoValueOperator(op) ? { op, value: '' } : { op });

  const chips = filters
    .map((f) => describeFilter(fieldsByKey[f.key], f, operatorsFor(fieldsByKey[f.key])))
    .filter(Boolean);

  return (
    <>
      {chips.length > 0 && (
        <div className="chips">{chips.map((c, i) => <span className="chip" key={i}>{c}</span>)}</div>
      )}
      {!filters.length && <p className="xs" style={{ marginBottom: 10 }}>No filters. Every case in the date range is included.</p>}

      {filters.map((filter, i) => {
        const field = fieldsByKey[filter.key];
        return (
          <div className="frow" key={i}>
            <FieldSelect fields={fields} value={filter.key} onChange={(key) => changeField(i, key)} />
            <select value={filter.op} onChange={(e) => changeOperator(i, e.target.value)} disabled={!field} aria-label="Condition">
              {operatorsFor(field).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <ValueInput field={field} filter={filter} onChange={(value) => update(i, { value })} isNoValueOperator={isNoValueOperator} />
            <button className="ib" onClick={() => onChange(filters.filter((_, j) => j !== i))} aria-label="Remove filter">✕</button>
          </div>
        );
      })}

      <button className="btn sm" onClick={() => onChange([...filters, { key: '', op: '', value: '' }])}>Add filter</button>
      <p className="hint">Rows are always sorted newest first on the date field above.</p>
    </>
  );
}
