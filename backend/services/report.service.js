/**
 * REPORT SERVICE — reads report rows from Postgres.
 *
 *   previewReport  — first N rows + total count, for the on-screen preview.
 *   streamReport   — every row, in batches, through a server-side cursor. Memory use stays flat
 *                    whether the report has 100 rows or 5 million.
 */

const Cursor = require('pg-cursor');
const env = require('../config/env');
const { reportTypes, withReportSession } = require('../db/pool');
const { buildReportQuery } = require('../utils/query-builder');

async function previewReport(template, range) {
  const { sql, countSql, params, columns } = buildReportQuery(template, range);

  return withReportSession(
    async (client) => {
      const rowsResult = await client.query({
        text: `${sql}\nLIMIT ${env.preview.rowLimit}`,
        values: params,
        types: reportTypes,
        rowMode: 'array',
      });
      const countResult = await client.query(countSql, params);
      return {
        columns,
        rows: rowsResult.rows,
        totalCount: Number(countResult.rows[0].total),
      };
    },
    { timeoutMs: env.preview.queryTimeoutSeconds * 1000 }
  );
}

/**
 * Prepares a full export. Usage:
 *
 *     const report = prepareExport(template, range);
 *     const writer = createReportWriter(format, path, report.columns);
 *     const rowCount = await report.streamRows((rows) => writer.writeRows(rows));
 *
 * streamRows calls `onBatch(rows, rowsSoFar)` for each batch of up to MIS_EXPORT_BATCH_SIZE rows
 * and waits for it before reading more, so a slow disk slows the read instead of filling memory.
 * Each row is an array in the same order as `columns`.
 */
function prepareExport(template, range) {
  const { sql, params, columns } = buildReportQuery(template, range);

  const streamRows = (onBatch) =>
    withReportSession(
      async (client) => {
        const cursor = client.query(new Cursor(sql, params, { types: reportTypes, rowMode: 'array' }));
        let rowCount = 0;
        try {
          for (;;) {
            const rows = await cursor.read(env.exports.batchSize);
            if (!rows.length) break;
            rowCount += rows.length;
            await onBatch(rows, rowCount);
          }
        } finally {
          await cursor.close().catch(() => {}); // never hide the original error
        }
        return rowCount;
      },
      { timeoutMs: env.exports.queryTimeoutMinutes * 60 * 1000 }
    );

  return { columns, streamRows };
}

module.exports = { previewReport, prepareExport };
