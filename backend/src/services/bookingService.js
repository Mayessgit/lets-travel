const { pool, withTransaction } = require('../db');
const { fault } = require('../errors');
const V = require('../validators');
const { requireAuth, requireAdmin, assertOwnerOrAdmin } = require('../auth');
const { toReservation } = require('../mappers');
const { RESERVATION_SQL, loadReservation, cancelReservationTx } = require('../domain');
const { notify } = require('../notifications');
const { lockPromo, discountFor } = require('../promo');
const { audit } = require('../audit');

const MAX_QUANTITY = 100;

const quantityOf = (v) => {
  const q = V.int(v, 'quantity');
  if (q > MAX_QUANTITY) throw fault('VALIDATION_ERROR', `Quantité maximale : ${MAX_QUANTITY}.`);
  return q;
};

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Règle 1 : authentification obligatoire. Règles 2 et 5 : stock vérifié puis décrémenté (verrou de ligne).
 * Code promo facultatif : validé et consommé dans la même transaction (incrément atomique).
 */
async function createReservation(args, headers) {
  const auth = await requireAuth(headers);
  const availabilityId = V.int(args.availabilityId, 'availabilityId');
  const quantity = quantityOf(args.quantity);
  const promoCode = V.promoCode(args.promoCode);

  const reservationId = await withTransaction(async (conn) => {
    const [avs] = await conn.query(
      'SELECT *, (date < CURDATE()) AS is_past FROM availabilities WHERE id = ? FOR UPDATE', [availabilityId]);
    if (avs.length === 0) throw fault('NOT_FOUND', 'Disponibilité introuvable.');
    const av = avs[0];
    if (av.is_past) throw fault('DATE_PASSED', 'Cette date est déjà passée.');
    if (av.available_slots < quantity) {
      throw fault('NOT_ENOUGH_SLOTS', `Places insuffisantes : ${av.available_slots} disponible(s).`);
    }
    const [svc] = await conn.query('SELECT price FROM services WHERE id = ?', [av.service_id]);
    const base = round2(Number(svc[0].price) * quantity);
    let total = base;
    let discount = null;
    if (promoCode) {
      const promo = await lockPromo(conn, promoCode);
      discount = discountFor(base, promo.percent);
      total = round2(base - discount);
      await conn.query('UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?', [promo.id]);
    }

    await conn.query('UPDATE availabilities SET available_slots = available_slots - ? WHERE id = ?', [quantity, av.id]);
    const [res] = await conn.query(
      "INSERT INTO reservations (user_id, service_id, availability_id, quantity, total_price, promo_code, discount_amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')",
      [auth.id, av.service_id, av.id, quantity, total, promoCode ?? null, discount]);
    await notify(conn, auth.id, 'RESERVATION_CREATED', 'Réservation créée',
      `Réservation n°${res.insertId} : ${quantity} place(s)${promoCode ? `, code ${promoCode}` : ''}. Payez-la avant son expiration.`);
    return res.insertId;
  });
  return { reservation: await loadReservation(reservationId) };
}

async function getReservation(args, headers) {
  const auth = await requireAuth(headers);
  const reservation = await loadReservation(V.int(args.reservationId, 'reservationId'));
  assertOwnerOrAdmin(auth, reservation.userId);
  return { reservation };
}

async function getUserReservations(args, headers) {
  const auth = await requireAuth(headers);
  const userId = V.int(args.userId, 'userId', { required: false }) ?? auth.id;
  assertOwnerOrAdmin(auth, userId);
  const status = V.oneOf(args.status, 'status', V.RESERVATION_STATUSES, { required: false });
  const [rows] = await pool.query(
    `${RESERVATION_SQL} WHERE r.user_id = ? ${status ? 'AND r.status = ?' : ''} ORDER BY r.created_at DESC, r.id DESC`,
    status ? [userId, status] : [userId]);
  return { reservation: rows.map(toReservation) };
}

async function cancelReservation(args, headers) {
  const auth = await requireAuth(headers);
  const id = V.int(args.reservationId, 'reservationId');
  let ownerId;
  let byAdmin = false;

  await withTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT * FROM reservations WHERE id = ? FOR UPDATE', [id]);
    if (rows.length === 0) throw fault('NOT_FOUND', 'Réservation introuvable.');
    ownerId = rows[0].user_id;
    assertOwnerOrAdmin(auth, ownerId);
    byAdmin = auth.role === 'ADMIN' && auth.id !== ownerId;
    await cancelReservationTx(conn, rows[0], byAdmin ? 'admin' : 'user');
  });
  // Une annulation faite par un administrateur sur le compte d'un autre est tracée.
  if (byAdmin) await audit(pool, auth.id, 'CANCEL_RESERVATION', 'RESERVATION', id, `utilisateur #${ownerId}`);
  return { reservation: await loadReservation(id) };
}

/** Modification de la quantité d'une réservation en attente de paiement (remise recalculée). */
async function updateReservation(args, headers) {
  const auth = await requireAuth(headers);
  const id = V.int(args.reservationId, 'reservationId');
  const quantity = quantityOf(args.quantity);

  await withTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT * FROM reservations WHERE id = ? FOR UPDATE', [id]);
    if (rows.length === 0) throw fault('NOT_FOUND', 'Réservation introuvable.');
    const r = rows[0];
    assertOwnerOrAdmin(auth, r.user_id);
    if (r.status !== 'PENDING') {
      throw fault('NOT_EDITABLE', 'Seule une réservation en attente de paiement peut être modifiée.');
    }
    const [avs] = await conn.query('SELECT * FROM availabilities WHERE id = ? FOR UPDATE', [r.availability_id]);
    const delta = quantity - r.quantity;
    if (delta > avs[0].available_slots) {
      throw fault('NOT_ENOUGH_SLOTS', `Places insuffisantes : ${avs[0].available_slots} disponible(s) en plus.`);
    }

    // Le prix unitaire est figé à la réservation ; une remise éventuelle reste au même pourcentage.
    const discount0 = Number(r.discount_amount || 0);
    const base0 = Number(r.total_price) + discount0;
    const unitPrice = base0 / r.quantity;
    const base = round2(unitPrice * quantity);
    const rate = discount0 > 0 ? discount0 / base0 : 0;
    const discount = rate > 0 ? round2(base * rate) : null;
    const total = round2(base - (discount || 0));

    await conn.query('UPDATE availabilities SET available_slots = available_slots - ? WHERE id = ?', [delta, r.availability_id]);
    await conn.query('UPDATE reservations SET quantity = ?, total_price = ?, discount_amount = ? WHERE id = ?',
      [quantity, total, discount, id]);
  });
  return { reservation: await loadReservation(id) };
}

async function getAllReservations(args, headers) {
  await requireAdmin(headers);
  const status = V.oneOf(args.status, 'status', V.RESERVATION_STATUSES, { required: false });
  const [rows] = await pool.query(
    `${RESERVATION_SQL} ${status ? 'WHERE r.status = ?' : ''} ORDER BY r.created_at DESC, r.id DESC`,
    status ? [status] : []);
  return { reservation: rows.map(toReservation) };
}

module.exports = { createReservation, getReservation, getUserReservations, cancelReservation, updateReservation, getAllReservations };
