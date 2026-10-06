/**
 * Builds a report file on the server and downloads it when ready.
 *
 *   const { job, start } = useExportJob();
 *   start({ templateId, dateFrom, dateTo, format: 'xlsx' });
 *
 * `job` is the History item (status queued -> running -> done | failed, rowCount grows while running).
 * Big reports take a while; the user can leave the page and download the file from History later.
 */

import { useEffect, useRef, useState } from 'react';
import { misApi, downloadFile } from '../../services/mis-api';
import { useMis } from './ui';

const POLL_MS = 1500;

export function useExportJob() {
  const { toast } = useMis();
  const [job, setJob] = useState(null);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'failed') return undefined;

    const timer = setTimeout(async () => {
      try {
        const latest = await misApi.getHistoryItem(job.id);
        if (latest.status === 'done') {
          downloadFile(misApi.fileUrl(latest.id));
          toastRef.current(`Downloaded as ${latest.format === 'xlsx' ? 'Excel' : 'CSV'}. Saved to History.`);
        } else if (latest.status === 'failed') {
          toastRef.current(latest.error || 'The report could not be built.');
        }
        setJob(latest);
      } catch (err) {
        setJob({ ...job, status: 'failed', error: err.message });
      }
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [job]);

  const start = async (request) => {
    try {
      setJob(await misApi.startExport(request));
    } catch (err) {
      toast(err.message);
    }
  };

  const busy = Boolean(job && (job.status === 'queued' || job.status === 'running'));
  return { job, busy, start, reset: () => setJob(null) };
}
