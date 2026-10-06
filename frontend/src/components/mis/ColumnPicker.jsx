/**
 * Builder step 3 — pick columns on the left, rename / reorder / choose repeat mode on the right.
 */

import React, { useState } from 'react';

const TYPE_LABEL = { text: 'Text', date: 'Date', datetime: 'Date + time', amount: 'Amount', number: 'Number', enum: 'Pick list', boolean: 'Yes / No' };
const REPEAT_MODES = [
  { key: 'latest', label: 'Latest' },
  { key: 'first', label: 'First' },
  { key: 'all', label: 'All, joined' },
  { key: 'count', label: 'Count' },
];

export default function ColumnPicker({ fields, fieldsByKey, columns, onChange }) {
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('');

  const selected = new Set(columns.map((c) => c.key));
  const groups = [...new Set(fields.map((f) => f.group))];
  const term = search.trim().toLowerCase();
  const available = fields.filter(
    (f) => (!group || f.group === group) && (!term || `${f.label} ${f.group}`.toLowerCase().includes(term))
  );

  const toggle = (field) =>
    onChange(
      selected.has(field.key)
        ? columns.filter((c) => c.key !== field.key)
        : [...columns, { key: field.key, label: field.label, mv: 'latest' }]
    );

  const update = (index, changes) => onChange(columns.map((c, i) => (i === index ? { ...c, ...changes } : c)));

  const move = (index, step) => {
    const next = [...columns];
    [next[index], next[index + step]] = [next[index + step], next[index]];
    onChange(next);
  };

  return (
    <>
      <div className="pick">
        {/* Left: every field in the workflow */}
        <div className="pane">
          <div className="pane-h">
            <strong>Available fields</strong>
            <span className="xs">{available.length} of {fields.length}</span>
          </div>
          <div className="pane-tools">
            <input type="search" placeholder="Search fields" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search fields" />
            <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Filter by group">
              <option value="">All groups</option>
              {groups.map((g) => <option key={g}>{g}</option>)}
            </select>
          </div>
          <div className="pane-b">
            <table>
              <thead>
                <tr><th /><th>Field</th><th>Group</th><th>Type</th></tr>
              </thead>
              <tbody>
                {available.map((f) => (
                  <tr key={f.key} onClick={() => toggle(f)}>
                    <td style={{ width: 26 }}>
                      <input type="checkbox" className="cb" checked={selected.has(f.key)} readOnly tabIndex={-1} aria-label={f.label} />
                    </td>
                    <td title={f.description}>
                      {f.label} {f.calculated && <span className="tg calc">calc</span>}
                      {f.repeating && <span className="tg">repeats</span>}
                    </td>
                    <td className="xs">{f.group}</td>
                    <td className="xs">{TYPE_LABEL[f.type]}</td>
                  </tr>
                ))}
                {!available.length && (
                  <tr><td colSpan={4} className="xs" style={{ padding: 14 }}>No fields match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: the report's columns, in file order */}
        <div className="pane">
          <div className="pane-h">
            <strong>Report columns, in order</strong>
            {columns.length > 0 && <button className="btn gh sm" onClick={() => onChange([])}>Clear all</button>}
          </div>
          <div className="pane-b">
            {!columns.length && <p className="xs" style={{ padding: 14 }}>No columns yet. Tick fields on the left.</p>}
            {columns.map((c, i) => {
              const field = fieldsByKey[c.key];
              if (!field) return null;
              return (
                <div className="selrow" key={c.key}>
                  <span className="ix">{i + 1}</span>
                  <div>
                    <input type="text" value={c.label} onChange={(e) => update(i, { label: e.target.value })} aria-label={`Header for ${field.label}`} />
                    <div className="src">
                      <span>{field.group} · {field.label}</span>
                      {field.repeating && (
                        <select value={c.mv} onChange={(e) => update(i, { mv: e.target.value })} aria-label="Repeating values">
                          {REPEAT_MODES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                        </select>
                      )}
                    </div>
                  </div>
                  <div className="acts">
                    <button className="ib" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                    <button className="ib" onClick={() => move(i, 1)} disabled={i === columns.length - 1} aria-label="Move down">↓</button>
                    <button className="ib" onClick={() => onChange(columns.filter((_, j) => j !== i))} aria-label="Remove">✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <p className="hint">
        Fields marked <span className="tg">repeats</span> can hold several values per case, such as replies or hearings.
        Choose whether the column shows the latest, first, all values joined, or a count.
      </p>
    </>
  );
}
