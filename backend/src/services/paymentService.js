const crypto = require('crypto');
const { pool, withTransaction } = require('../db');
const { fault } = require('../errors');
const V = require('../validators');
const { requireAuth, requireAdmin, assertOwnerOrAdmin } = require('../auth');
const { toPayment } = require('../mappers');
const { cancelReservationTx } = require('../domain');
const { notify } = require('../notifications');
const { audit } = require('../audit');

async function loadPayment(id, conn = pool) {
  const [rows] = await conn.query(
    'SELECT p.*, r.user_id FROM payments p JOIN reservations r ON r.id = p.reservation_id WHERE p.id = ?', [id]);
  if (rows.length === 0) throw fault('NOT_FOUND', 'Paiement introuvable.');
  return rows[0];
}

/**
 * Paiement SIMULÉ (aucune banque). Le montant est calculé côté serveur à partir de la réservation.
 * simulateFailure=true force un paiement FAILED pour tester ce scénario.
 * Règle 3 : la réservation passe à CONFIRMED uniquement si le paiement est PAID.
 */
async function createPayment(args, headers) {
  const auth = await requireAuth(headers);
  const reservationId = V.int(args.reservationId, 'reservationId');
  const method = V.oneOf(args.method, 'method', V.PAYMENT_METHODS);
  const fail = V.bool(args.simulateFailure);

  const paymentId = await withTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT * FROM reservations WHERE id = ? FOR UPDATE', [reservationId]);
    if (rows.length === 0) throw fault('NOT_FOUND', 'Réservation introuvable.');
    const r = rows[0];
    assertOwnerOrAdmin(auth, r.user_id);
    if (r.status === 'CANCELLED') throw fault('RESERVATION_CANCELLED', 'Cette réservation est annulée.');
    if (r.status === 'CONFIRMED') throw fault('ALREADY_PAID', 'Cette réservation est déjà payée.');

    const [existing] = await conn.query('SELECT * FROM payments WHERE reservation_id = ? FOR UPDATE', [reservationId]);
    if (existing.length > 0 && existing[0].status !== 'FAILED') {
      throw fault('PAYMENT_EXISTS', 'Un paiement existe déjà pour cette réservation.');
    }

    const status = fail ? 'FAILED' : 'PAID';
    const ref = `TXN-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    let id;
    if (existing.length > 0) { // nouvelle tentative après un échec : on réutilise la ligne (relation 1:1)
      await conn.query('UPDATE payments SET amount = ?, method = ?, transaction_ref = ?, status = ? WHERE id = ?',
        [r.total_price, method, ref, status, existing[0].id]);
      id = existing[0].id;
    } else {
      const [ins] = await conn.query(
        'INSERT INTO payments (reservation_id, amount, method, transaction_ref, status) VALUES (?, ?, ?, ?, ?)',
        [reservationId, r.total_price, method, ref, status]);
      id = ins.insertId;
    }
    if (status === 'PAID') {
      await conn.query("UPDATE reservations SET status = 'CONFIRMED' WHERE id = ?", [reservationId]);
      await notify(conn, r.user_id, 'PAYMENT_ACCEPTED', 'Paiement accepté',
        `Réservation n°${reservationId} confirmée : ${r.total_price} TND réglés par ${method}.`);
    } else {
      await notify(conn, r.user_id, 'PAYMENT_FAILED', 'Paiement refusé',
        `Le paiement de la réservation n°${reservationId} a été refusé. Vous pouvez réessayer.`);
    }
    return id;
  });
  return { payment: toPayment(await loadPayment(paymentId)) };
}

async function getPayment(args, headers) {
  const auth = await requireAuth(headers);
  const p = await loadPayment(V.int(args.paymentId, 'paymentId'));
  assertOwnerOrAdmin(auth, p.user_id);
  return { payment: toPayment(p) };
}

async function getPaymentByReservation(args, headers) {
  const auth = await requireAuth(headers);
  const [rows] = await pool.query(
    'SELECT p.*, r.user_id FROM payments p JOIN reservations r ON r.id = p.reservation_id WHERE p.reservation_id = ?',
    [V.int(args.reservationId, 'reservationId')]);
  if (rows.length === 0) throw fault('NOT_FOUND', 'Aucun paiement pour cette réservation.');
  assertOwnerOrAdmin(auth, rows[0].user_id);
  return { payment: toPayment(rows[0]) };
}

/** Historique des paiements de l'utilisateur connecté, enrichi du service et de la date. */
async function getMyPayments(_args, headers) {
  const auth = await requireAuth(headers);
  const [rows] = await pool.query(
    `SELECT p.*, s.name AS service_name, a.date AS date
     FROM payments p
     JOIN reservations r ON r.id = p.reservation_id
     JOIN services s ON s.id = r.service_id
     JOIN availabilities a ON a.id = r.availability_id
     WHERE r.user_id = ?
     ORDER BY p.created_at DESC, p.id DESC`, [auth.id]);
  return { payment: rows.map(toPayment) };
}

/** Remboursement (admin) : paiement REFUNDED, réservation annulée, places restituées. */
async function refundPayment(args, headers) {
  const auth = await requireAdmin(headers);
  const id = V.int(args.paymentId, 'paymentId');
  await withTransaction(async (conn) => {
    const [pays] = await conn.query('SELECT * FROM payments WHERE id = ? FOR UPDATE', [id]);
    if (pays.length === 0) throw fault('NOT_FOUND', 'Paiement introuvable.');
    if (pays[0].status !== 'PAID') throw fault('NOT_REFUNDABLE', 'Seul un paiement au statut PAID peut être remboursé.');
    const [res] = await conn.query('SELECT * FROM reservations WHERE id = ? FOR UPDATE', [pays[0].reservation_id]);
    await cancelReservationTx(conn, res[0], 'admin'); // passe aussi le paiement à REFUNDED
  });
  await audit(pool, auth.id, 'REFUND_PAYMENT', 'PAYMENT', id, 'remboursement administrateur');
  return { payment: toPayment(await loadPayment(id)) };
}

async function getAllPayments(args, headers) {
  await requireAdmin(headers);
  const status = V.oneOf(args.status, 'status', V.PAYMENT_STATUSES, { required: false });
  const [rows] = await pool.query(
    `SELECT * FROM payments ${status ? 'WHERE status = ?' : ''} ORDER BY created_at DESC, id DESC`,
    status ? [status] : []);
  return { payment: rows.map(toPayment) };
}

module.exports = { createPayment, getPayment, getPaymentByReservation, getMyPayments, refundPayment, getAllPayments };
