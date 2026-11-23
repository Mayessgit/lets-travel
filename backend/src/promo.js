// Règles des codes promo : validité (existe, actif, dans les dates, utilisations restantes)
// et restitution de l'utilisation quand une réservation est annulée ou expire.
const { fault } = require('./errors');

const PROMO_SELECT = "SELECT *, DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today FROM promo_codes";

/** Vérifie qu'un code est utilisable et lève le code d'erreur précis (INVALID / EXPIRED / EXHAUSTED). */
function assertUsable(p) {
  if (!p.active) throw fault('PROMO_INVALID', "Ce code promo n'est plus actif.");
  // Dates comparées en texte AAAA-MM-JJ (dateStrings activé sur le pool).
  if (p.today < p.valid_from || p.today > p.valid_to) {
    throw fault('PROMO_EXPIRED', "Ce code promo n'est pas valable à cette date.");
  }
  if (p.max_uses !== null && p.max_uses !== undefined && p.used_count >= p.max_uses) {
    throw fault('PROMO_EXHAUSTED', "Ce code promo a atteint sa limite d'utilisation.");
  }
  return p;
}

/** Verrouille la ligne du code (FOR UPDATE) avant de consommer une utilisation. */
async function lockPromo(conn, code) {
  const [rows] = await conn.query(`${PROMO_SELECT} WHERE code = ? FOR UPDATE`, [code]);
  if (rows.length === 0) throw fault('PROMO_INVALID', 'Code promo inconnu.');
  return assertUsable(rows[0]);
}

/** Lecture simple, sans transaction (aperçu du prix). */
async function loadPromo(conn, code) {
  const [rows] = await conn.query(`${PROMO_SELECT} WHERE code = ?`, [code]);
  if (rows.length === 0) throw fault('PROMO_INVALID', 'Code promo inconnu.');
  return assertUsable(rows[0]);
}

/** Restitue une utilisation (annulation, expiration). */
async function releasePromo(conn, code) {
  await conn.query('UPDATE promo_codes SET used_count = GREATEST(used_count - 1, 0) WHERE code = ?', [code]);
}

/** Remise en pourcentage, arrondie au centime. */
const discountFor = (amount, percent) => Math.round(Number(amount) * percent) / 100;

module.exports = { lockPromo, loadPromo, releasePromo, discountFor };
