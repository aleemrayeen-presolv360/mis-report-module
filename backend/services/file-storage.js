/**
 * FILE STORAGE — where generated report files live.
 *
 * Files are stored on local disk under MIS_EXPORT_DIR as "<history id>.<xlsx|csv>".
 * To move to S3: keep these function names and change only this file.
 */

const fs = require('fs');
const path = require('path');
const env = require('../config/env');

fs.mkdirSync(env.exports.dir, { recursive: true });

function fileKeyFor(historyId, format) {
  return `${historyId}.${format}`;
}

// Absolute path for a stored file. basename() blocks "../" tricks even though keys are ours.
function pathFor(fileKey) {
  return path.join(env.exports.dir, path.basename(fileKey));
}

function fileExists(fileKey) {
  return Boolean(fileKey) && fs.existsSync(pathFor(fileKey));
}

async function fileSize(fileKey) {
  const stats = await fs.promises.stat(pathFor(fileKey));
  return stats.size;
}

async function removeFile(fileKey) {
  if (!fileKey) return;
  await fs.promises.rm(pathFor(fileKey), { force: true });
}

module.exports = { fileKeyFor, pathFor, fileExists, fileSize, removeFile };
