/**
 * TEMPLATE SERVICE — saved report definitions (cms.report_templates).
 */

const { query, withTransaction } = require('../db/pool');
const { validateTemplate } = require('../utils/validators');
const { badRequest, notFound } = require('../utils/http-error');

const UNIQUE_VIOLATION = '23505';
const DUPLICATE_NAME = 'This enterprise already has a report with that name.';

const SELECT_TEMPLATE = `
  SELECT t.*, updater.email AS updated_by_email
  FROM cms.report_templates t
  LEFT JOIN auth.account updater ON updater.id = t.updated_by`;

function toTemplate(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    enterpriseId: row.enterprise_id,
    workflow: row.workflow,
    dateBasis: row.date_basis,
    status: row.status,
    columns: row.columns,
    filters: row.filters,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedByEmail: row.updated_by_email || '',
  };
}

async function listTemplates({ enterpriseId, workflow, status }) {
  const params = [enterpriseId];
  let sql = `${SELECT_TEMPLATE} WHERE t.enterprise_id = $1`;
  if (workflow) {
    params.push(workflow);
    sql += ` AND t.workflow = $${params.length}`;
  }
  if (status) {
    params.push(status);
    sql += ` AND t.status = $${params.length}`;
  }
  const { rows } = await query(`${sql} ORDER BY t.updated_at DESC`, params);
  return rows.map(toTemplate);
}

async function getTemplate(id) {
  const { rows } = await query(`${SELECT_TEMPLATE} WHERE t.id = $1`, [id]);
  if (!rows.length) throw notFound('This report no longer exists.');
  return toTemplate(rows[0]);
}

async function createTemplate(input, userId) {
  const { value, errors } = validateTemplate(input);
  if (errors.length) throw badRequest('Fix these before saving', errors);

  const { rows } = await saveOrExplainDuplicate(() =>
    query(
      `INSERT INTO cms.report_templates
         (name, description, enterprise_id, workflow, date_basis, status, columns, filters, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       RETURNING id`,
      [value.name, value.description, value.enterpriseId, value.workflow, value.dateBasis, value.status,
        JSON.stringify(value.columns), JSON.stringify(value.filters), userId]
    )
  );
  return getTemplate(rows[0].id);
}

async function updateTemplate(id, input, userId) {
  const { value, errors } = validateTemplate(input);
  if (errors.length) throw badRequest('Fix these before saving', errors);

  const { rowCount } = await saveOrExplainDuplicate(() =>
    query(
      `UPDATE cms.report_templates
       SET name = $1, description = $2, enterprise_id = $3, workflow = $4, date_basis = $5, status = $6,
           columns = $7, filters = $8, updated_by = $9, updated_at = now()
       WHERE id = $10`,
      [value.name, value.description, value.enterpriseId, value.workflow, value.dateBasis, value.status,
        JSON.stringify(value.columns), JSON.stringify(value.filters), userId, id]
    )
  );
  if (!rowCount) throw notFound('This report no longer exists.');
  return getTemplate(id);
}

// Copy is always a Draft so it cannot be run by mistake before someone checks it.
async function duplicateTemplate(id, userId) {
  const original = await getTemplate(id);
  const name = await freeCopyName(original.enterpriseId, original.name);
  const { rows } = await query(
    `INSERT INTO cms.report_templates
       (name, description, enterprise_id, workflow, date_basis, status, columns, filters, created_by, updated_by)
     SELECT $2, description, enterprise_id, workflow, date_basis, 'Draft', columns, filters, $3, $3
     FROM cms.report_templates WHERE id = $1
     RETURNING id`,
    [id, name, userId]
  );
  return getTemplate(rows[0].id);
}

/**
 * Deletes the template and its email schedules. History rows stay (template_id becomes NULL),
 * so past files can still be downloaded.
 * @returns {{ name: string, stoppedSchedules: number }}
 */
async function deleteTemplate(id) {
  return withTransaction(async (client) => {
    const schedules = await client.query('DELETE FROM cms.report_schedules WHERE template_id = $1', [id]);
    const deleted = await client.query('DELETE FROM cms.report_templates WHERE id = $1 RETURNING name', [id]);
    if (!deleted.rowCount) throw notFound('This report no longer exists.');
    return { name: deleted.rows[0].name, stoppedSchedules: schedules.rowCount };
  });
}

/* ------------------------------------------------------------------ */

// The unique index on (enterprise_id, lower(name)) is the real guard; this turns its error into a message.
async function saveOrExplainDuplicate(runQuery) {
  try {
    return await runQuery();
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) throw badRequest('Fix these before saving', [DUPLICATE_NAME]);
    throw err;
  }
}

// "Name (copy)", or "Name (copy 2)", "Name (copy 3)"... if that is taken.
async function freeCopyName(enterpriseId, name) {
  const { rows } = await query(
    `SELECT lower(name) AS name FROM cms.report_templates
     WHERE enterprise_id = $1 AND lower(name) LIKE lower($2) || ' (copy%'`,
    [enterpriseId, name]
  );
  const taken = new Set(rows.map((r) => r.name));
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? `${name} (copy)` : `${name} (copy ${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

module.exports = { listTemplates, getTemplate, createTemplate, updateTemplate, duplicateTemplate, deleteTemplate };
