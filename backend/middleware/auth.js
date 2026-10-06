/**
 * Who is calling, and may they see this enterprise?
 *
 * Inside the Litelo backend, the platform's own auth middleware already sets req.user
 * ({ id, email }) before these routes run. For local development, MIS_DEV_USER_ID in .env
 * stands in for a logged-in user.
 */

const env = require('../config/env');
const { HttpError, forbidden } = require('../utils/http-error');

function requireUser(req, res, next) {
  if (!req.user && env.devUser) req.user = env.devUser;
  if (!req.user || !req.user.id) {
    // Standalone server with no host-app login: say exactly what to set.
    const hint = env.devUser ? '' : ' (Running the MIS backend on its own? Set MIS_DEV_USER_ID in backend/.env and restart.)';
    return next(new HttpError(401, `Please sign in.${hint}`));
  }
  next();
}

/**
 * Throws 403 if the user may not work with this enterprise.
 *
 * Today every MIS user is on the Litelo team and manages all enterprises, so this allows everyone.
 * When client users get access, check auth.member / auth.member_org_access here — it is the one
 * place every route goes through.
 */
function assertEnterpriseAccess(user, enterpriseId) {
  const allowed = Boolean(user && enterpriseId);
  if (!allowed) throw forbidden();
}

module.exports = { requireUser, assertEnterpriseAccess };
