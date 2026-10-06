/**
 * SCREEN 3 — Report download. Pick an Active report and a date range, preview real data,
 * then download Excel / CSV or set it to email on a schedule.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { misApi } from '../../services/mis-api';
import { useMis, EnterpriseSelect, DataTable, ReportSentence } from './ui';
import { DATE_PRESETS, presetRange, formatDate, formatTime, formatCount, plural } from './format';
import { useExportJob } from './useExportJob';
import EmailScheduleModal from './EmailScheduleModal';

const FREQUENCY_TEXT = { daily: 'every day', weekly: 'every week', monthly: 'every month' };

export default function ReportDownload({ enterpriseId, onEnterpriseChange, rerun, onRerunHandled }) {
  const { enterpriseName, workflowLabel, toast } = useMis();

  const [templates, setTemplates] = useState(null); // Active templates of this enterprise, all workflows
  const [selectedId, setSelectedId] = useState('');
  const [preset, setPreset] = useState('this_month');
  const [range, setRange] = useState(presetRange('this_month'));

  const [result, setResult] = useState(null); // { template, fieldsByKey, range, generatedAt, preview }
  const [generating, setGenerating] = useState(false);
  const [schedule, setSchedule] = useState(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const exportJob = useExportJob();
  const pendingRerun = useRef(null);
  const generateRef = useRef(null);

  /* ---------- loading ---------- */

  useEffect(() => {
    setTemplates(null);
    setResult(null);
    if (!enterpriseId) return;
    misApi
      .listTemplates({ enterpriseId, status: 'Active' })
      .then((list) => {
        setTemplates(list);
        setSelectedId((current) => (list.some((t) => t.id === current) ? current : list[0] ? list[0].id : ''));
      })
      .catch((err) => toast(err.message));
  }, [enterpriseId, toast]);

  // "Run with latest data" from History: select the report and dates, then generate.
  // Taken once, then cleared in the parent so it does not repeat on the next visit to this tab.
  useEffect(() => {
    if (!rerun) return;
    pendingRerun.current = rerun;
    onRerunHandled();
  }, [rerun, onRerunHandled]);

  useEffect(() => {
    const request = pendingRerun.current;
    if (!request || !templates) return;
    pendingRerun.current = null;
    const template = templates.find((t) => t.id === request.templateId);
    if (!template) {
      toast('That report has been deleted or set to Draft, so it cannot be re-run.');
      return;
    }
    setSelectedId(template.id);
    setPreset('custom');
    setRange({ from: request.dateFrom, to: request.dateTo });
    // generate() is read through a ref so this effect runs only when the template list arrives.
    generateRef.current(template, { from: request.dateFrom, to: request.dateTo }).then(() => toast('Rebuilt with the latest data'));
  }, [templates, toast]);

  /* ---------- actions ---------- */

  const choosePreset = (key) => {
    setPreset(key);
    const dates = presetRange(key);
    if (dates) setRange(dates);
  };

  const changeDate = (which, value) => {
    setPreset('custom');
    setRange((r) => ({ ...r, [which]: value }));
  };

  async function generate(template, dates) {
    if (!dates.from || !dates.to) return toast('Choose both a start and an end date.');
    if (dates.from > dates.to) return toast('The start date is after the end date.');

    setGenerating(true);
    exportJob.reset();
    try {
      const [preview, fields, schedules] = await Promise.all([
        misApi.previewReport({ templateId: template.id, dateFrom: dates.from, dateTo: dates.to }),
        misApi.getCatalog(template.workflow),
        misApi.listSchedules(template.id),
      ]);
      setResult({
        template,
        fieldsByKey: Object.fromEntries(fields.map((f) => [f.key, f])),
        range: dates,
        generatedAt: new Date(),
        preview,
      });
      setSchedule(schedules[0] || null);
    } catch (err) {
      toast(err.message);
    } finally {
      setGenerating(false);
    }
  }

  generateRef.current = generate;

  const download = (format) =>
    exportJob.start({ templateId: result.template.id, dateFrom: result.range.from, dateTo: result.range.to, format });

  const cancelSchedule = async () => {
    try {
      await misApi.deleteSchedule(schedule.id);
      setSchedule(null);
      toast('Scheduled email cancelled');
    } catch (err) {
      toast(err.message);
    }
  };

  /* ---------- render ---------- */

  const byWorkflow = useMemo(() => {
    const groups = {};
    (templates || []).forEach((t) => (groups[t.workflow] = groups[t.workflow] || []).push(t));
    return groups;
  }, [templates]);

  const selected = (templates || []).find((t) => t.id === selectedId);

  return (
    <>
      <div className="ph">
        <div>
          <h1>Report download</h1>
          <p className="mut sm">Pick a report and a date range, then download it or set it to email on a schedule. Only Active reports appear here.</p>
        </div>
      </div>

      <div className="fbar">
        <EnterpriseSelect value={enterpriseId} onChange={onEnterpriseChange} />
        <div className="fg" style={{ flex: 1 }}>
          <span>&nbsp;</span>
          <p className="xs">{templates ? `${plural(templates.length, 'active report')} available` : 'Loading…'}</p>
        </div>
      </div>

      <div className="run">
        <div className="panel pad">
          <h3>Report</h3>
          {templates && !templates.length && <p className="xs" style={{ marginTop: 8 }}>No active reports for this enterprise yet.</p>}
          {Object.entries(byWorkflow).map(([wf, list]) => (
            <React.Fragment key={wf}>
              <p className="xs" style={{ margin: '13px 0 6px' }}>{workflowLabel(wf)}</p>
              {list.map((t) => (
                <label className="ropt" key={t.id}>
                  <input type="radio" name="report" value={t.id} checked={selectedId === t.id} onChange={() => setSelectedId(t.id)} />
                  <strong>{t.name}</strong>
                  <span className="xs">{t.description}</span>
                  <span className="xs" style={{ marginTop: 3 }}>{plural(t.columns.length, 'column')}</span>
                </label>
              ))}
            </React.Fragment>
          ))}

          <h3 style={{ marginTop: 18 }}>Date range</h3>
          <div className="presets" role="group">
            {DATE_PRESETS.map((p) => (
              <button key={p.key} aria-pressed={preset === p.key} onClick={() => choosePreset(p.key)}>{p.label}</button>
            ))}
          </div>
          <div className="row">
            <label className="fld"><span>From</span><input type="date" value={range.from} onChange={(e) => changeDate('from', e.target.value)} /></label>
            <label className="fld"><span>To</span><input type="date" value={range.to} onChange={(e) => changeDate('to', e.target.value)} /></label>
          </div>
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }}
            disabled={!selected || generating} onClick={() => generate(selected, range)}>
            {generating ? 'Generating…' : 'Generate report'}
          </button>
        </div>

        <div>
          {!result ? (
            <div className="panel empty">
              <h3>Pick a report and a date range</h3>
              <p>Choose on the left, then generate. The report opens here and you can download it as Excel or CSV.</p>
            </div>
          ) : (
            <ResultPanel
              result={result}
              enterpriseName={enterpriseName(result.template.enterpriseId)}
              workflowLabel={workflowLabel(result.template.workflow)}
              schedule={schedule}
              exportJob={exportJob}
              onDownload={download}
              onEmail={() => setEmailOpen(true)}
              onCancelSchedule={cancelSchedule}
            />
          )}
        </div>
      </div>

      {emailOpen && result && (
        <EmailScheduleModal
          template={result.template}
          range={result.range}
          existing={schedule}
          onClose={() => setEmailOpen(false)}
          onSaved={(saved, sentNow) => {
            setSchedule(saved);
            setEmailOpen(false);
            toast(sentNow
              ? `First email is on its way. Repeats ${FREQUENCY_TEXT[saved.frequency]} at ${saved.sendTime} until ${formatDate(saved.endDate)}`
              : 'Schedule updated');
          }}
        />
      )}
    </>
  );
}

function ResultPanel({ result, enterpriseName, workflowLabel, schedule, exportJob, onDownload, onEmail, onCancelSchedule }) {
  const { template, fieldsByKey, range, generatedAt, preview } = result;
  const { job, busy } = exportJob;
  const rangeText = `${formatDate(range.from)} and ${formatDate(range.to)}`;
  const percent = job && preview.totalCount ? Math.min(100, Math.round((job.rowCount / preview.totalCount) * 100)) : 0;

  return (
    <div className="panel pad">
      <div className="rh">
        <div>
          <h3 style={{ fontSize: 16 }}>{template.name}</h3>
          <p className="xs">
            {enterpriseName} · {workflowLabel} · {formatDate(range.from)} to {formatDate(range.to)} · generated {formatTime(generatedAt)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" disabled={busy} onClick={() => onDownload('csv')}>Download CSV</button>
          <button className="btn" disabled={busy} onClick={() => onDownload('xlsx')}>Download Excel</button>
          <button className="btn primary" onClick={onEmail}>✉ Email</button>
        </div>
      </div>

      {busy && (
        <div className="jobbar">
          <div>
            <b>Preparing your {job.format === 'xlsx' ? 'Excel' : 'CSV'} file</b> — {formatCount(job.rowCount)} of {formatCount(preview.totalCount)} rows.
            <span className="xs"> You can leave this page; the file will also be in History.</span>
            <div className="progress"><span style={{ width: `${percent}%` }} /></div>
          </div>
        </div>
      )}

      {schedule && (
        <div className="sched">
          <span>
            Emailing <b>{FREQUENCY_TEXT[schedule.frequency]}</b> at <b>{schedule.sendTime}</b> until{' '}
            <b>{formatDate(schedule.endDate)}</b> to <b>{schedule.recipients.join(', ')}</b>
          </span>
          <span style={{ display: 'flex', gap: 6 }}>
            <button className="btn sm" onClick={onEmail}>Edit</button>
            <button className="btn gh sm dngr" onClick={onCancelSchedule}>Cancel</button>
          </span>
        </div>
      )}

      <p className="sent sm" style={{ fontSize: 13, marginBottom: 13 }}>
        <ReportSentence template={template} fieldsByKey={fieldsByKey} enterpriseName={enterpriseName} rangeText={rangeText} />
      </p>

      <div className="pv">
        <DataTable columns={preview.columns} rows={preview.rows} emptyText="This report has no columns yet." />
      </div>
      <p className="xs" style={{ marginTop: 11 }}>
        {preview.totalCount === 0
          ? 'No cases match this date range.'
          : `Showing the first ${formatCount(preview.rows.length)} of ${plural(preview.totalCount, 'row')}. The file includes every row.`}
      </p>
    </div>
  );
}
