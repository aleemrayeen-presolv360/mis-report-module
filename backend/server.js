/**
 * MIS Report backend — standalone server.
 *
 * Inside the main Litelo backend you only need two lines (see INTEGRATION_GUIDE.md):
 *     app.use('/api/mis', require('./mis/routes/report.routes'));
 *     startExportWorker(); startScheduler();
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const env = require('./config/env');
const { pool } = require('./db/pool');
const misRoutes = require('./routes/report.routes');
const { errorHandler } = require('./middleware/error-handler');
const { startExportWorker } = require('./jobs/export-worker');
const { startScheduler } = require('./jobs/scheduler');

/**
 * Checks the setup before starting, so a missing .env or a wrong DB password shows one clear
 * message instead of a 401 / connection error on every request.
 */
async function checkSetup() {
  const problems = [];
  if (!fs.existsSync(path.join(__dirname, '.env'))) {
    problems.push('No backend/.env file. Copy .env.example to .env and fill it in.');
  }
  if (!env.db.user) problems.push('DB_USER is empty in .env.');
  if (env.readOnly) {
    problems.push('DB_READ_ONLY=true: the full server must save templates and history, so it cannot run read-only. Use "npm run sit" for read-only SIT testing.');
  }
  if (!env.devUser) {
    console.warn('[mis] MIS_DEV_USER_ID is empty, so every request will get "Please sign in" (401) unless the host app sets req.user.');
  }

  try {
    const { rows } = await pool.query(
      "SELECT to_regclass('cms.report_templates') AS templates, to_regclass('cms.report_history') AS history"
    );
    if (!rows[0].templates || !rows[0].history) {
      problems.push('MIS tables are missing. Run database/migrations.sql (Part 1) on this database.');
    }
    if (env.devUser) {
      const user = await pool.query('SELECT 1 FROM auth.account WHERE id = $1', [env.devUser.id]);
      if (!user.rowCount) problems.push(`MIS_DEV_USER_ID ${env.devUser.id} is not in auth.account.`);
    }
  } catch (err) {
    problems.push(`Cannot connect to Postgres at ${env.db.host}:${env.db.port}/${env.db.database}: ${err.message || err.code}`);
  }
  return problems;
}

async function start() {
  const problems = await checkSetup();
  if (problems.length) {
    console.error('\n[mis] Cannot start — fix these first:');
    problems.forEach((p) => console.error(`  • ${p}`));
    console.error('');
    process.exit(1);
  }

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use('/api/mis', misRoutes);
  app.use(errorHandler);

  const server = app.listen(env.port, () => {
    console.log(`[mis] API listening on http://localhost:${env.port}/api/mis`);
    if (env.runWorkers) {
      startExportWorker();
      startScheduler();
    } else {
      console.log('[mis] MIS_RUN_WORKERS=false — not building files or sending scheduled emails on this server');
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[mis] Port ${env.port} is already in use — another backend is probably running. Stop it, or set PORT in .env.`);
    } else {
      console.error('[mis] server error:', err);
    }
    process.exit(1);
  });
}

start();
