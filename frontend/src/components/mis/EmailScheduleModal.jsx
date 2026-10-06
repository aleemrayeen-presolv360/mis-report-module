/**
 * "Email this report" dialog. Creating a schedule sends the first email straight away;
 * editing one only changes future sends.
 */

import React, { useRef, useState } from 'react';
import { misApi } from '../../services/mis-api';
import { useMis, Modal, ErrorList } from './ui';
import { toIsoDate } from './format';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FREQUENCIES = [
  { key: 'daily', label: 'Every day' },
  { key: 'weekly', label: 'Every week' },
  { key: 'monthly', label: 'Every month' },
];

function threeMonthsFromNow() {
  const d = new Date();
  d.setMonth(d.getMonth() + 3);
  return toIsoDate(d);
}

export default function EmailScheduleModal({ template, range, existing, onClose, onSaved }) {
  const { enterpriseName, workflowLabel } = useMis();
  const [form, setForm] = useState(
    existing
      ? { recipients: existing.recipients, frequency: existing.frequency, sendTime: existing.sendTime, endDate: existing.endDate, format: existing.format }
      : { recipients: [], frequency: 'weekly', sendTime: '09:00', endDate: threeMonthsFromNow(), format: 'xlsx' }
  );
  const [typed, setTyped] = useState('');
  const [errors, setErrors] = useState([]);
  const [sending, setSending] = useState(false);
  const inputRef = useRef(null);
  const set = (changes) => setForm((f) => ({ ...f, ...changes }));

  // Adds whatever is typed as a chip. Returns the new list (or null if the address is invalid).
  const addTyped = () => {
    const address = typed.trim().replace(/[,;]$/, '').toLowerCase();
    if (!address) return form.recipients;
    if (!EMAIL.test(address)) {
      setErrors([`"${address}" is not a valid email address.`]);
      return null;
    }
    const recipients = form.recipients.includes(address) ? form.recipients : [...form.recipients, address];
    set({ recipients });
    setTyped('');
    setErrors([]);
    return recipients;
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      addTyped();
    } else if (e.key === 'Backspace' && !typed && form.recipients.length) {
      set({ recipients: form.recipients.slice(0, -1) });
    }
  };

  const send = async () => {
    const recipients = addTyped();
    if (!recipients) return;
    if (!recipients.length) return setErrors(['Add at least one email address.']);

    setSending(true);
    try {
      const body = { ...form, recipients, templateId: template.id, dateFrom: range.from, dateTo: range.to };
      if (existing) onSaved(await misApi.updateSchedule(existing.id, body), false);
      else onSaved((await misApi.createSchedule(body)).schedule, true);
    } catch (err) {
      setErrors(err.errors && err.errors.length ? err.errors : [err.message]);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal onClose={onClose} label="Email this report">
      <h2>Email this report</h2>
      <p className="mut sm" style={{ marginBottom: 16 }}>
        {template.name} · {enterpriseName(template.enterpriseId)} · {workflowLabel(template.workflow)}
      </p>

      <div className="fld">
        <span>Send to</span>
        <div className="emchips" onClick={() => inputRef.current && inputRef.current.focus()}>
          {form.recipients.map((address) => (
            <span className="emchip" key={address}>
              {address}
              <button onClick={() => set({ recipients: form.recipients.filter((a) => a !== address) })} aria-label={`Remove ${address}`}>✕</button>
            </span>
          ))}
          <input ref={inputRef} type="text" value={typed} autoFocus aria-label="Email address"
            placeholder={form.recipients.length ? 'Add another' : 'name@company.com'}
            onChange={(e) => setTyped(e.target.value)} onKeyDown={onKeyDown} onBlur={addTyped} />
        </div>
        <p className="hint">Press Enter or comma after each address.</p>
      </div>

      <div className="row">
        <label className="fld">
          <span>How often</span>
          <select value={form.frequency} onChange={(e) => set({ frequency: e.target.value })}>
            {FREQUENCIES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </label>
        <label className="fld">
          <span>Time (IST)</span>
          <input type="time" step="1800" value={form.sendTime} onChange={(e) => set({ sendTime: e.target.value })} />
        </label>
      </div>
      <div className="row">
        <label className="fld">
          <span>Keep sending until</span>
          <input type="date" value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} />
        </label>
        <label className="fld">
          <span>File format</span>
          <select value={form.format} onChange={(e) => set({ format: e.target.value })}>
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="csv">CSV</option>
          </select>
        </label>
      </div>

      <div className="note" style={{ marginBottom: 14 }}>
        <div>
          Each email covers the <b>same number of days as the range you just ran, ending on the send date</b>, so a weekly
          email always carries the latest week.
        </div>
      </div>
      <ErrorList title="Check these" errors={errors} />
      <div className="macts" style={{ marginTop: 14 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={send} disabled={sending}>
          {sending ? 'Sending…' : existing ? 'Save changes' : 'Send'}
        </button>
      </div>
    </Modal>
  );
}
