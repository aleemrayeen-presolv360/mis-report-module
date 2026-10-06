/**
 * All settings the MIS module reads from the environment, with defaults.
 * Copy `.env.example` to `.env` and change values there — never hard-code them in other files.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function readInt(name, fallback) {
  const value = parseInt(process.env[name], 10);
  return Number.isFinite(value) ? value : fallback;
}

module.exports = {
  port: readInt('PORT', 5000),

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: readInt('DB_PORT', 5432),
    database: process.env.DB_NAME || 'sit_lwms',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    max: readInt('DB_POOL_MAX', 10),
    // DB_READ_ONLY=true: every connection is opened read-only, so Postgres rejects any write.
    options: process.env.DB_READ_ONLY === 'true' ? '-c default_transaction_read_only=on' : undefined,
  },
  readOnly: process.env.DB_READ_ONLY === 'true',

  exports: {
    // Where generated files are written. Use a shared volume (or swap file-storage.js for S3) when running more than one server.
    dir: process.env.MIS_EXPORT_DIR || path.join(__dirname, '..', 'exports'),
    // Rows read from Postgres per round trip. Larger = faster but more memory.
    batchSize: readInt('MIS_EXPORT_BATCH_SIZE', 5000),
    // How many files one server builds at the same time. Others wait in the queue.
    maxConcurrent: readInt('MIS_MAX_CONCURRENT_EXPORTS', 2),
    // A single export query is cancelled after this long.
    queryTimeoutMinutes: readInt('MIS_EXPORT_TIMEOUT_MINUTES', 60),
    // Files older than this are deleted from disk; the History row stays.
    retentionDays: readInt('MIS_FILE_RETENTION_DAYS', 90),
  },

  preview: {
    rowLimit: readInt('MIS_PREVIEW_ROWS', 50),
    queryTimeoutSeconds: readInt('MIS_PREVIEW_TIMEOUT_SECONDS', 60),
  },

  // Set to false on servers that should only answer API calls and not build files or send scheduled emails.
  runWorkers: process.env.MIS_RUN_WORKERS !== 'false',

  // Used only when the host app has not already put the logged-in user on req.user (local development).
  devUser: process.env.MIS_DEV_USER_ID
    ? { id: process.env.MIS_DEV_USER_ID, email: process.env.MIS_DEV_USER_EMAIL || '' }
    : null,

  email: {
    from: process.env.MIS_EMAIL_FROM || 'Litelo Reports <reports@litelo.ai>',
    // Files bigger than this are not attached; the email asks the reader to download from History instead.
    maxAttachmentMb: readInt('MIS_EMAIL_MAX_ATTACHMENT_MB', 20),
    smtp: process.env.SMTP_HOST
      ? {
          host: process.env.SMTP_HOST,
          port: readInt('SMTP_PORT', 587),
          secure: process.env.SMTP_SECURE === 'true',
          auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
        }
      : null,
  },
};
