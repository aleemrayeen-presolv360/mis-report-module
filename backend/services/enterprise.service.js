/**
 * ENTERPRISE SERVICE — the client organisations reports are built for (auth.organization).
 */

const { query } = require('../db/pool');

async function listEnterprises() {
  const { rows } = await query(
    'SELECT id, name FROM auth.organization WHERE is_active ORDER BY name'
  );
  return rows;
}

async function getEnterpriseName(id) {
  const { rows } = await query('SELECT name FROM auth.organization WHERE id = $1', [id]);
  return rows.length ? rows[0].name : 'Unknown';
}

module.exports = { listEnterprises, getEnterpriseName };
