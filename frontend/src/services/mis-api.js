/**
 * MIS API — every call the Report screens make to the backend (/api/mis).
 * Errors are thrown as Error objects with `.errors` (a list of user-facing messages) and `.status`.
 */

const BASE_URL = process.env.REACT_APP_MIS_API_URL || '/api/mis';

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    credentials: 'include', // send the Litelo session cookie
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.errors = data.errors || [];
    error.status = response.status;
    throw error;
  }
  return data;
}

// Builds "?a=1&b=2", skipping empty values.
function queryString(params) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries)}` : '';
}

export const misApi = {
  // Reference data
  getConfig: () => request('/config'),
  getEnterprises: () => request('/enterprises').then((d) => d.enterprises),
  getCatalog: (workflow) => request(`/catalog/${workflow}`).then((d) => d.fields),

  // Templates
  listTemplates: ({ enterpriseId, workflow, status }) =>
    request(`/templates${queryString({ enterpriseId, workflow, status })}`).then((d) => d.templates),
  createTemplate: (template) => request('/templates', { method: 'POST', body: template }).then((d) => d.template),
  updateTemplate: (id, template) => request(`/templates/${id}`, { method: 'PUT', body: template }).then((d) => d.template),
  duplicateTemplate: (id) => request(`/templates/${id}/duplicate`, { method: 'POST' }).then((d) => d.template),
  deleteTemplate: (id) => request(`/templates/${id}`, { method: 'DELETE' }), // -> { name, stoppedSchedules }

  // Running reports
  previewReport: ({ templateId, dateFrom, dateTo }) =>
    request('/reports/preview', { method: 'POST', body: { templateId, dateFrom, dateTo } }),
  startExport: ({ templateId, dateFrom, dateTo, format }) =>
    request('/reports/export', { method: 'POST', body: { templateId, dateFrom, dateTo, format } }).then((d) => d.job),

  // History
  listHistory: ({ enterpriseId, search, limit, offset }) =>
    request(`/history${queryString({ enterpriseId, search, limit, offset })}`), // -> { items, total }
  getHistoryItem: (id) => request(`/history/${id}`).then((d) => d.item),
  fileUrl: (historyId) => `${BASE_URL}/history/${historyId}/file`,

  // Email schedules
  listSchedules: (templateId) => request(`/schedules${queryString({ templateId })}`).then((d) => d.schedules),
  createSchedule: (schedule) => request('/schedules', { method: 'POST', body: schedule }), // -> { schedule, firstJob }
  updateSchedule: (id, schedule) => request(`/schedules/${id}`, { method: 'PUT', body: schedule }).then((d) => d.schedule),
  deleteSchedule: (id) => request(`/schedules/${id}`, { method: 'DELETE' }),
};

/**
 * Starts a browser download of a URL. The browser streams the file straight to disk, so even a
 * multi-GB report never has to fit in the page's memory (unlike fetch + blob).
 */
export function downloadFile(url) {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}
