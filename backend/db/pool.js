/**
 * Postgres connection pool for the MIS module.
 * When moving into the main Litelo backend, export the existing pool from here instead.
 */

const { Pool, types } = require('pg');
const env = require('../config/env');

const pool = new Pool(env.db);

pool.on('error', (err) => {
  // An idle client died (e.g. DB restart). The pool replaces it; just log it.
  console.error('[db] idle client error:', err.message);
});

/**
 * Read DATE columns as plain 'YYYY-MM-DD' strings. By default pg turns them into JS Dates at
 * server-local midnight, which shifts the day on servers that are not in IST.
 * Applied only to MIS queries (passed as `types`), so the rest of the app is unaffected.
 */
const DATE_OID = 1082;
const reportTypes = {
  getTypeParser: (oid, format) => (oid === DATE_OID ? (value) => value : types.getTypeParser(oid, format)),
};

// Use this instead of pool.query everywhere in the MIS module.
function query(text, values = [], client = pool) {
  return client.query({ text, values, types: reportTypes });
}

/**
 * Run `fn(client)` on a dedicated connection set up for reports:
 *   - timezone Asia/Kolkata, so CURRENT_DATE and `::date` are Indian dates
 *   - a statement timeout, so a runaway query cannot hold a connection forever
 * Both settings are reset before the connection goes back to the pool.
 */
async function withReportSession(fn, { timeoutMs }) {
  const client = await pool.connect();
  let broken = null;
  try {
    await client.query(`SET TIME ZONE 'Asia/Kolkata'; SET statement_timeout = ${Math.floor(Number(timeoutMs))}`);
    return await fn(client);
  } finally {
    try {
      await client.query('RESET TIME ZONE; RESET statement_timeout');
    } catch (err) {
      broken = err; // do not reuse a connection we could not reset
    }
    client.release(broken);
  }
}

// Run `fn(client)` inside BEGIN/COMMIT, rolling back on any error.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, reportTypes, withReportSession, withTransaction };
