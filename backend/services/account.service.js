/**
 * ACCOUNT SERVICE — Litelo users (auth.account), for showing who is signed in.
 */

const { query } = require('../db/pool');

// { id, email, name } for the header. Falls back to what the host app put on req.user.
async function describeUser(user) {
  const { rows } = await query('SELECT email, first_name, last_name FROM auth.account WHERE id = $1', [user.id]);
  if (!rows.length) return { id: user.id, email: user.email || '', name: '' };
  const { email, first_name: first, last_name: last } = rows[0];
  return { id: user.id, email, name: [first, last].filter(Boolean).join(' ') };
}

module.exports = { describeUser };
