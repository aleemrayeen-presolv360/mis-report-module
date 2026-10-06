/**
 * SCREEN 1 — Report templates for one enterprise and one workflow.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { misApi } from '../../services/mis-api';
import { useMis, EnterpriseSelect, WorkflowSwitch } from './ui';
import { relativeDay } from './format';

export default function TemplateList({ enterpriseId, workflow, onEnterpriseChange, onWorkflowChange, onNew, onEdit }) {
  const { enterpriseName, workflowLabel, toast, confirm } = useMis();
  const [templates, setTemplates] = useState(null); // null = loading
  const [dateLabels, setDateLabels] = useState({}); // dateBasis key -> label, for the "Date range applies to" column
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    setError('');
    Promise.all([misApi.listTemplates({ enterpriseId, workflow }), misApi.getCatalog(workflow)])
      .then(([list, fields]) => {
        setTemplates(list);
        setDateLabels(Object.fromEntries(fields.map((f) => [f.key, f.label])));
      })
      .catch((err) => setError(err.message));
  }, [enterpriseId, workflow]);

  useEffect(() => {
    setTemplates(null);
    if (enterpriseId) load();
  }, [enterpriseId, load]);

  const duplicate = async (template) => {
    try {
      await misApi.duplicateTemplate(template.id);
      toast('Duplicated as a draft');
      load();
    } catch (err) {
      toast(err.message);
    }
  };

  const remove = async (template) => {
    const yes = await confirm({
      title: 'Delete this report?',
      body: `"${template.name}" will be removed from the list. Any scheduled email for it will stop. Past downloads stay in History.`,
      label: 'Delete',
      danger: true,
    });
    if (!yes) return;
    try {
      const { stoppedSchedules } = await misApi.deleteTemplate(template.id);
      toast(`Deleted "${template.name}"${stoppedSchedules ? '. Its scheduled email was stopped.' : ''}`);
      load();
    } catch (err) {
      toast(err.message);
    }
  };

  const term = search.trim().toLowerCase();
  const visible = (templates || []).filter((t) => !term || `${t.name} ${t.description}`.toLowerCase().includes(term));

  return (
    <>
      <div className="ph">
        <div>
          <h1>Report templates</h1>
          <p className="mut sm">Build the reports your enterprise can run. They pick a report and a date range, nothing else.</p>
        </div>
        <button className="btn primary" onClick={onNew}>New report</button>
      </div>

      <div className="fbar">
        <EnterpriseSelect value={enterpriseId} onChange={onEnterpriseChange} />
        <div className="fg">
          <span>Workflow</span>
          <WorkflowSwitch value={workflow} onChange={onWorkflowChange} />
        </div>
        <label className="fg" style={{ flex: 1, minWidth: 190 }}>
          <span>Search</span>
          <input type="search" placeholder="Search reports" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>

      {error && <div className="alert">{error}</div>}
      {!templates && !error && <div className="loading">Loading reports…</div>}

      {templates && visible.length > 0 && (
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Report</th>
                <th>Date range applies to</th>
                <th className="n">Columns</th>
                <th>Status</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong style={{ fontWeight: 500 }}>{t.name}</strong>
                    {t.description && <div className="xs" style={{ marginTop: 2 }}>{t.description}</div>}
                  </td>
                  <td className="sm">{dateLabels[t.dateBasis] || '—'}</td>
                  <td className="n sm">{t.columns.length}</td>
                  <td><span className={`pill ${t.status === 'Active' ? 'p-a' : 'p-d'}`}>{t.status}</span></td>
                  <td className="sm">
                    {relativeDay(t.updatedAt)}
                    <div className="xs">{t.updatedByEmail}</div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn sm" onClick={() => onEdit(t)}>Edit</button>{' '}
                    <button className="btn gh sm" onClick={() => duplicate(t)}>Duplicate</button>{' '}
                    <button className="btn gh sm dngr" onClick={() => remove(t)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {templates && visible.length === 0 && (
        <div className="panel empty">
          <h3>
            {term ? `No reports match "${search}"` : `No reports for ${enterpriseName(enterpriseId)} on ${workflowLabel(workflow)}`}
          </h3>
          <p>Create a template and it appears in the enterprise's report list straight away.</p>
          <button className="btn primary" onClick={onNew}>New report</button>
        </div>
      )}
    </>
  );
}
