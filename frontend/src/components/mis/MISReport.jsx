/**
 * MIS REPORT — the "Report" page. Three tabs, as in litelo-reports-v2.html:
 *
 *   Report templates  (Screen 1, and Screen 2 the builder when creating/editing)
 *   Report download   (Screen 3)
 *   History           (Screen 4)
 *
 * This component owns what the tabs share: the selected enterprise and workflow, the toast,
 * the confirm dialog, and the reference data (workflows, filter operators, enterprises).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { misApi } from '../../services/mis-api';
import { MisContext, ConfirmDialog, Toast } from './ui';
import TemplateList from './TemplateList';
import ReportBuilder from './ReportBuilder';
import ReportDownload from './ReportDownload';
import ReportHistory from './ReportHistory';
import './mis-report.css';

const TABS = [
  { key: 'templates', label: 'Report templates' },
  { key: 'download', label: 'Report download' },
  { key: 'history', label: 'History' },
];

export default function MISReport() {
  const [reference, setReference] = useState(null); // { config, enterprises }
  const [loadError, setLoadError] = useState('');

  const [tab, setTab] = useState('templates');
  const [enterpriseId, setEnterpriseId] = useState('');
  const [workflow, setWorkflow] = useState('section138');
  const [editing, setEditing] = useState(null); // template being built/edited, or null for the list
  const [rerun, setRerun] = useState(null); // { templateId, dateFrom, dateTo } from History "Run with latest data"

  const [toastMessage, setToastMessage] = useState('');
  const [confirmState, setConfirmState] = useState(null);
  const toastTimer = useRef(null);
  const clearRerun = useCallback(() => setRerun(null), []);

  useEffect(() => {
    Promise.all([misApi.getConfig(), misApi.getEnterprises()])
      .then(([config, enterprises]) => {
        setReference({ config, enterprises });
        setEnterpriseId(enterprises[0] ? enterprises[0].id : '');
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  const toast = useCallback((message) => {
    setToastMessage(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMessage(''), 2800);
  }, []);

  // confirm({ title, body, label, danger }) -> Promise<boolean>
  const confirm = useCallback(
    (options) => new Promise((resolve) => setConfirmState({ ...options, resolve })),
    []
  );

  const context = useMemo(() => {
    if (!reference) return null;
    const { config, enterprises } = reference;
    return {
      config,
      enterprises,
      enterpriseName: (id) => (enterprises.find((e) => e.id === id) || {}).name || '',
      workflowLabel: (key) => (config.workflows.find((w) => w.key === key) || {}).label || key,
      operatorsFor: (field) => (field ? config.operators[config.operatorGroupByType[field.type]] || [] : []),
      isNoValueOperator: (op) => config.noValueOperators.includes(op),
      toast,
      confirm,
    };
  }, [reference, toast, confirm]);

  if (loadError) return <div className="panel empty"><h3>Reports could not load</h3><p>{loadError}</p></div>;
  if (!context) return <div className="loading">Loading reports…</div>;

  const openTab = (key) => {
    setTab(key);
    setEditing(null);
    window.scrollTo(0, 0);
  };

  const startNew = () =>
    setEditing({ id: null, name: '', description: '', enterpriseId, workflow, dateBasis: '', status: 'Draft', columns: [], filters: [] });

  const afterSave = (saved) => {
    setEnterpriseId(saved.enterpriseId);
    setWorkflow(saved.workflow);
    setEditing(null);
    toast(`Saved ${saved.name}`);
  };

  const runAgain = (item) => {
    setEnterpriseId(item.enterpriseId);
    setRerun({ templateId: item.templateId, dateFrom: item.dateFrom, dateTo: item.dateTo, at: Date.now() });
    openTab('download');
  };

  return (
    <MisContext.Provider value={context}>
      <nav className="tabs" aria-label="Reports">
        {TABS.map((t) => (
          <button key={t.key} aria-current={tab === t.key ? 'page' : 'false'} onClick={() => openTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'templates' &&
          (editing ? (
            <ReportBuilder initial={editing} onCancel={() => setEditing(null)} onSaved={afterSave} />
          ) : (
            <TemplateList
              enterpriseId={enterpriseId}
              workflow={workflow}
              onEnterpriseChange={setEnterpriseId}
              onWorkflowChange={setWorkflow}
              onNew={startNew}
              onEdit={(template) => setEditing(JSON.parse(JSON.stringify(template)))}
            />
          ))}

        {tab === 'download' && (
          <ReportDownload
            enterpriseId={enterpriseId}
            onEnterpriseChange={setEnterpriseId}
            rerun={rerun}
            onRerunHandled={clearRerun}
          />
        )}

        {tab === 'history' && (
          <ReportHistory
            enterpriseId={enterpriseId}
            onEnterpriseChange={setEnterpriseId}
            onRunAgain={runAgain}
            onGoToDownload={() => openTab('download')}
          />
        )}
      </main>

      {confirmState && (
        <ConfirmDialog
          {...confirmState}
          onAnswer={(yes) => {
            confirmState.resolve(yes);
            setConfirmState(null);
          }}
        />
      )}
      <Toast message={toastMessage} />
    </MisContext.Provider>
  );
}
