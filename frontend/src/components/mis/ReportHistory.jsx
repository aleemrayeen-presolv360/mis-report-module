/**
 * SCREEN 4 — History. Every file downloaded or emailed for an enterprise, newest first.
 *   Download again       -> the exact file built at that time
 *   Run with latest data -> same report and dates, rebuilt from today's data
 */

import React, { useCallback, useEffect, useState } from 'react';
import { misApi, downloadFile } from '../../services/mis-api';
import { useMis, EnterpriseSelect } from './ui';
import { formatDate, formatTime, formatCount, relativeDay } from './format';

const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;
const REFRESH_WHILE_BUILDING_MS = 3000;

function StatusCell({ item }) {
  if (item.status === 'failed') {
    return (
      <>
        <span className="pill p-f">Failed</span>
        <div className="xs" style={{ marginTop: 3, maxWidth: 220, whiteSpace: 'normal' }}>{item.error}</div>
      </>
    );
  }
  if (item.status !== 'done') {
    return <span className="pill p-d">{item.status === 'queued' ? 'Waiting…' : `Building · ${formatCount(item.rowCount)} rows`}</span>;
  }
  return (
    <>
      <span className={`pill ${item.format === 'xlsx' ? 'p-i' : 'p-n'}`}>{item.format === 'xlsx' ? 'Excel' : 'CSV'}</span>
      {item.delivery === 'Email' && <div className="xs" style={{ marginTop: 3 }}>✉ Emailed</div>}
    </>
  );
}

export default function ReportHistory({ enterpriseId, onEnterpriseChange, onRunAgain, onGoToDownload }) {
  const { workflowLabel, toast } = useMis();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState(null); // { items, total }

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(0);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchPage = useCallback(
    () => misApi.listHistory({ enterpriseId, search: debouncedSearch, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    [enterpriseId, debouncedSearch, page]
  );

  useEffect(() => {
    if (!enterpriseId) return undefined;
    let cancelled = false;
    fetchPage()
      .then((result) => !cancelled && setData(result))
      .catch((err) => !cancelled && toast(err.message));
    return () => {
      cancelled = true;
    };
  }, [enterpriseId, fetchPage, toast]);

  // Keep the list fresh while any file on this page is still being built.
  const building = data && data.items.some((h) => h.status === 'queued' || h.status === 'running');
  useEffect(() => {
    if (!building) return undefined;
    const timer = setTimeout(() => fetchPage().then(setData).catch(() => {}), REFRESH_WHILE_BUILDING_MS);
    return () => clearTimeout(timer);
  }, [building, data, fetchPage]);

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <div className="ph">
        <div>
          <h1>Download history</h1>
          <p className="mut sm">Every report pulled or emailed for this enterprise, by anyone. Files stay available for 90 days.</p>
        </div>
      </div>

      <div className="fbar">
        <EnterpriseSelect value={enterpriseId} onChange={onEnterpriseChange} />
        <label className="fg" style={{ flex: 1, minWidth: 190 }}>
          <span>Search</span>
          <input type="search" placeholder="Search by report, file or person" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>

      {!data && <div className="loading">Loading history…</div>}

      {data && data.items.length > 0 && (
        <>
          <div className="note">
            <div>
              <b>Download again</b> gives the exact file that was generated then, unchanged. <b>Run with latest data</b> rebuilds
              the report from today's data, using the same dates.
            </div>
          </div>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>Report</th><th>Workflow</th><th>Date range</th><th className="n">Rows</th><th>Format</th><th>Generated</th><th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((h) => (
                  <tr key={h.id}>
                    <td style={{ minWidth: 230 }}>
                      <strong style={{ fontWeight: 500 }}>{h.templateName}</strong>
                      <div className="xs fname" style={{ marginTop: 2 }}>{h.fileName}</div>
                    </td>
                    <td><span className="pill p-n">{workflowLabel(h.workflow)}</span></td>
                    <td className="sm" style={{ whiteSpace: 'nowrap' }}>{formatDate(h.dateFrom)}<div className="xs">to {formatDate(h.dateTo)}</div></td>
                    <td className="n sm">{formatCount(h.rowCount)}</td>
                    <td><StatusCell item={h} /></td>
                    <td className="sm">
                      {relativeDay(h.generatedAt)}
                      <div className="xs">{formatTime(h.generatedAt)} · {h.generatedByEmail}</div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                        <button className="btn sm" disabled={!(h.status === 'done' && h.hasFile)}
                          title={h.status === 'done' && !h.hasFile ? 'Older than 90 days — use Run with latest data' : undefined}
                          onClick={() => downloadFile(misApi.fileUrl(h.id))}>
                          Download again
                        </button>
                        <button className="btn gh sm" disabled={!h.templateId} onClick={() => onRunAgain(h)}
                          title={h.templateId ? undefined : 'This report has been deleted'}>
                          Run with latest data
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="pager">
              <button className="btn sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
              <span>Page {page + 1} of {pages}</span>
              <button className="btn sm" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          )}
        </>
      )}

      {data && data.items.length === 0 && (
        <div className="panel empty">
          <h3>{debouncedSearch ? `Nothing matches "${debouncedSearch}"` : 'Nothing downloaded yet'}</h3>
          <p>Reports you generate and download appear here, so you can pull the same file again without setting it up twice.</p>
          <button className="btn primary" onClick={onGoToDownload}>Run a report</button>
        </div>
      )}
    </>
  );
}
