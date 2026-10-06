/**
 * Errors that should reach the user as a 4xx response.
 * Throw these from services; middleware/error-handler.js turns them into JSON.
 * Anything else that is thrown becomes a generic 500 and is logged.
 */

class HttpError extends Error {
  constructor(status, message, errors = []) {
    super(message);
    this.status = status;
    this.errors = errors; // list of user-facing messages, e.g. validation problems
  }
}

const badRequest = (message, errors = []) => new HttpError(400, message, errors);
const forbidden = (message = 'You do not have access to this enterprise.') => new HttpError(403, message);
const notFound = (message = 'Not found.') => new HttpError(404, message);
const gone = (message) => new HttpError(410, message);

module.exports = { HttpError, badRequest, forbidden, notFound, gone };
