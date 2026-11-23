const { pool } = require('../db');
const { fault } = require('../errors');
const V = require('../validators');
const { hashPassword, checkPassword, signToken, requireAuth, requireAdmin, assertOwnerOrAdmin } = require('../auth');
const { toUser } = require('../mappers');
const { audit } = require('../audit');
const limiter = require('../loginLimiter');

const flag = (v) => v === true || v === 'true';

/** Refuse de retirer le dernier ADMIN (rétrogradation ou suppression). */
async function assertNotLastAdmin(target) {
  if (target.role !== 'ADMIN') return;
  const [rows] = await pool.query("SELECT COUNT(*) AS n FROM users WHERE role = 'ADMIN'");
  if (rows[0].n <= 1) throw fault('LAST_ADMIN', 'Impossible : il doit rester au moins un administrateur.');
}

async function findUser(id) {
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  if (rows.length === 0) throw fault('NOT_FOUND', 'Utilisateur introuvable.');
  return rows[0];
}

async function registerUser(args) {
  const name = V.str(args.name, 'name', { min: 2, max: 100 });
  const email = V.email(args.email);
  const password = V.password(args.password);
  const phone = V.phone(args.phone);

  const [exists] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  if (exists.length > 0) throw fault('EMAIL_EXISTS', 'Un compte existe déjà avec cet email.');

  const hash = await hashPassword(password);
  // Le rôle ADMIN ne peut jamais être choisi à l'inscription.
  const [result] = await pool.query(
    "INSERT INTO users (name, email, password_hash, phone, role) VALUES (?, ?, ?, ?, 'USER')",
    [name, email, hash, phone ?? null],
  );
  return { user: toUser(await findUser(result.insertId)) };
}

async function loginUser(args) {
  const email = V.email(args.email);
  const password = V.str(args.password, 'password', { max: 72 });
  // Avant bcrypt : 5 échecs récents bloquent même un mot de passe correct.
  limiter.assertNotLocked(email);
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  // Même message dans les deux cas pour ne pas révéler quels emails existent.
  if (rows.length === 0 || !(await checkPassword(password, rows[0].password_hash))) {
    limiter.recordFailure(email);
    throw fault('BAD_CREDENTIALS', 'Email ou mot de passe incorrect.');
  }
  limiter.recordSuccess(email);
  return { token: signToken(rows[0]), user: toUser(rows[0]) };
}

async function getUser(args, headers) {
  const auth = await requireAuth(headers);
  const id = V.int(args.userId, 'userId', { required: false }) ?? auth.id;
  assertOwnerOrAdmin(auth, id);
  return { user: toUser(await findUser(id)) };
}

async function updateUser(args, headers) {
  const auth = await requireAuth(headers);
  const id = V.int(args.userId, 'userId', { required: false }) ?? auth.id;
  assertOwnerOrAdmin(auth, id);
  const target = await findUser(id);

  const sets = [];
  const params = [];
  const name = V.str(args.name, 'name', { min: 2, max: 100, required: false });
  if (name !== undefined) { sets.push('name = ?'); params.push(name); }
  const phone = V.phone(args.phone);
  // removePhone l'emporte sur phone, comme removeAvatar sur avatar.
  if (flag(args.removePhone)) {
    sets.push('phone = NULL');
  } else if (phone !== undefined) {
    sets.push('phone = ?'); params.push(phone);
  }
  if (V.opt(args.password) !== undefined) {
    const newPassword = V.password(args.password);
    if (auth.id === id) { // on change son propre mot de passe : l'ancien est exigé
      const current = V.opt(args.currentPassword);
      if (current === undefined || !(await checkPassword(String(current), target.password_hash))) {
        throw fault('BAD_CREDENTIALS', 'Mot de passe actuel incorrect.');
      }
    }
    sets.push('password_hash = ?');
    params.push(await hashPassword(newPassword));
  }
  if (flag(args.removeAvatar)) {
    sets.push('avatar = NULL');
  } else {
    const avatar = V.avatar(args.avatar);
    if (avatar !== undefined) { sets.push('avatar = ?'); params.push(avatar); }
  }
  const role = V.oneOf(args.role, 'role', V.ROLES, { required: false });
  if (role !== undefined) {
    if (auth.role !== 'ADMIN') throw fault('FORBIDDEN', 'Seul un administrateur peut modifier un rôle.');
    if (role !== 'ADMIN') await assertNotLastAdmin(target);
    sets.push('role = ?'); params.push(role);
  }
  if (sets.length === 0) throw fault('VALIDATION_ERROR', 'Aucune donnée à modifier.');

  await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  // Un changement de rôle est une action sensible : on la trace.
  if (role !== undefined && role !== target.role) {
    await audit(pool, auth.id, 'CHANGE_ROLE', 'USER', id, `${target.role} → ${role}`);
  }
  return { user: toUser(await findUser(id)) };
}

async function deleteUser(args, headers) {
  const auth = await requireAuth(headers);
  const id = V.int(args.userId, 'userId', { required: false }) ?? auth.id;
  assertOwnerOrAdmin(auth, id);
  const target = await findUser(id);

  // Suppression de son propre compte : le mot de passe est exigé (un admin qui supprime
  // le compte d'un AUTRE utilisateur n'a pas à saisir de mot de passe).
  if (auth.id === id) {
    const password = V.opt(args.password);
    if (password === undefined || !(await checkPassword(String(password), target.password_hash))) {
      throw fault('BAD_CREDENTIALS', 'Mot de passe incorrect : le compte n\'a pas été supprimé.');
    }
  }
  await assertNotLastAdmin(target);

  const [active] = await pool.query(
    "SELECT COUNT(*) AS n FROM reservations WHERE user_id = ? AND status <> 'CANCELLED'", [id]);
  if (active[0].n > 0) {
    throw fault('HAS_ACTIVE_RESERVATIONS', 'Annulez d\'abord les réservations actives avant de supprimer le compte.');
  }
  await pool.query('DELETE FROM users WHERE id = ?', [id]);
  if (auth.role === 'ADMIN' && auth.id !== id) {
    await audit(pool, auth.id, 'DELETE_USER', 'USER', id, `${target.name} (${target.email})`);
  }
  return { message: 'Compte supprimé.' };
}

async function listUsers(_args, headers) {
  await requireAdmin(headers);
  // Sans la photo : on évite d'envoyer N images dans une simple liste
  const [rows] = await pool.query('SELECT id, name, email, phone, role, created_at FROM users ORDER BY id');
  return { user: rows.map(toUser) };
}

module.exports = { registerUser, loginUser, getUser, updateUser, deleteUser, listUsers };
