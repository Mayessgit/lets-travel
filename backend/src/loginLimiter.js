// Compteur en mémoire des échecs de connexion, par email.
// Il disparaît au redémarrage du processus : suffisant pour un mini-projet mono-instance.
const { fault } = require('./errors');
const { loginMaxAttempts, loginLockMinutes } = require('./config');

const failures = new Map(); // email minuscule -> timestamps des échecs encore dans la fenêtre
const windowMs = () => loginLockMinutes * 60 * 1000;

function fresh(email) {
  const now = Date.now();
  const list = (failures.get(email) || []).filter((t) => now - t < windowMs());
  if (list.length === 0) failures.delete(email);
  else failures.set(email, list);
  return list;
}

/** À appeler avant la comparaison du mot de passe : un compte verrouillé est refusé même si le mot de passe est bon. */
function assertNotLocked(email) {
  const list = fresh(email);
  if (list.length < loginMaxAttempts) return;
  const remainingMs = windowMs() - (Date.now() - list[0]);
  const minutes = Math.max(1, Math.ceil(remainingMs / 60000));
  throw fault('TOO_MANY_ATTEMPTS', `Trop de tentatives. Réessayez dans ${minutes} minute(s).`);
}

function recordFailure(email) {
  const list = fresh(email);
  list.push(Date.now());
  failures.set(email, list);
}

function recordSuccess(email) {
  failures.delete(email);
}

// Les entrées expirées ne doivent pas retenir le processus (tests, arrêt propre).
setInterval(() => {
  for (const email of [...failures.keys()]) fresh(email);
}, 60_000).unref();

module.exports = { assertNotLocked, recordFailure, recordSuccess };
