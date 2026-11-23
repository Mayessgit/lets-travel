const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { jwtSecret, jwtExpiresIn } = require('./config');
const { pool } = require('./db');
const { fault } = require('./errors');

const hashPassword = (plain) => bcrypt.hash(plain, 10);
const checkPassword = (plain, hash) => bcrypt.compare(plain, hash);

const signToken = (user) => jwt.sign({ sub: user.id, role: user.role }, jwtSecret, { expiresIn: jwtExpiresIn });

/** Lit le JWT dans l'en-tête SOAP <AuthToken>. */
function extractToken(headers) {
  let raw = headers && headers.AuthToken;
  if (raw && typeof raw === 'object') raw = raw.$value ?? raw._;
  if (typeof raw !== 'string') return null;
  return raw.replace(/^Bearer\s+/i, '').trim() || null;
}

/** Vérifie le token puis recharge l'utilisateur en base (rôle à jour, compte supprimé => refus). */
async function requireAuth(headers) {
  const token = extractToken(headers);
  if (!token) throw fault('AUTH_REQUIRED', 'Authentification requise : en-tête SOAP AuthToken manquant.');
  let payload;
  try {
    payload = jwt.verify(token, jwtSecret);
  } catch {
    throw fault('INVALID_TOKEN', 'Token invalide ou expiré. Veuillez vous reconnecter.');
  }
  const [rows] = await pool.query('SELECT id, role FROM users WHERE id = ?', [payload.sub]);
  if (rows.length === 0) throw fault('INVALID_TOKEN', 'Compte introuvable.');
  return { id: rows[0].id, role: rows[0].role };
}

async function requireAdmin(headers) {
  const auth = await requireAuth(headers);
  if (auth.role !== 'ADMIN') throw fault('FORBIDDEN', 'Opération réservée aux administrateurs.');
  return auth;
}

/** Un utilisateur n'accède qu'à ses propres données, un admin à tout. */
function assertOwnerOrAdmin(auth, ownerId) {
  if (auth.role !== 'ADMIN' && auth.id !== ownerId) throw fault('FORBIDDEN', 'Accès refusé à cette ressource.');
}

module.exports = { hashPassword, checkPassword, signToken, requireAuth, requireAdmin, assertOwnerOrAdmin };
