/**
 * Express helpers so route handlers don't each need try/catch.
 */

const { HttpError } = require('../utils/http-error');

// Wrap an async route handler so a thrown error goes to the error handler.
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, errors: err.errors });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'The request body is not valid JSON.', errors: [] });
  }
  console.error(`[api] ${req.method} ${req.originalUrl} failed:`, err);
  res.status(500).json({ error: 'Something went wrong. Please try again.', errors: [] });
}

module.exports = { asyncHandler, errorHandler };
