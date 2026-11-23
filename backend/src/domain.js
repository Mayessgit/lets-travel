// Logique métier partagée entre les services (réservations, avis, notes).
const { pool } = require('./db');
const { fault } = require('./errors');
const { toReservation } = require('./mappers');
const { notify } = require('./notifications');
const { releasePromo } = require('./promo');

const RESERVATION_SQL = `
  SELECT r.*, s.name AS service_name, s.type AS service_type, a.date AS date
  FROM reservations r
  JOIN services s ON s.id = r.service_id
  JOIN availabilities a ON a.id = r.availability_id`;

// Note moyenne et nombre d'avis joints à chaque lecture de service (une seule requête, pas de N+1).
const SERVICE_JOIN = `
  LEFT JOIN (
    SELECT service_id, AVG(rating) AS avg_rating, COUNT(*) AS review_count
    FROM reviews GROUP BY service_id
  ) rev ON rev.service_id = s.id`;
const SERVICE_SQL = `SELECT s.*, rev.avg_rating, rev.review_count FROM services s${SERVICE_JOIN}`;

const REVIEW_SQL = `
  SELECT rv.*, u.name AS user_name, s.name AS service_name
  FROM reviews rv
  JOIN users u ON u.id = rv.user_id
  JOIN services s ON s.id = rv.service_id`;

/** Réservation enrichie (nom du service, date) ; lève NOT_FOUND si absente. */
async function loadReservation(id, conn = pool) {
  const [rows] = await conn.query(`${RESERVATION_SQL} WHERE r.id = ?`, [id]);
  if (rows.length === 0) throw fault('NOT_FOUND', 'Réservation introuvable.');
  return toReservation(rows[0]);
}

const CANCEL_MESSAGES = {
  user: (id) => `Vous avez annulé la réservation n°${id}.`,
  admin: (id) => `Un administrateur a annulé votre réservation n°${id}.`,
  expired: (id) => `La réservation n°${id} a été annulée : elle n'a pas été payée dans le délai imparti.`,
};

/**
 * Annule une réservation DANS une transaction déjà ouverte :
 *  règle 4 : la réservation n'est plus active,
 *  règle 5 : les places sont restituées,
 *  un paiement PAID est automatiquement remboursé,
 *  le code promo éventuel est restitué, l'utilisateur est notifié.
 * `r` est la ligne brute de reservations (verrouillée par l'appelant).
 */
async function cancelReservationTx(conn, r, reason = 'user') {
  if (r.status === 'CANCELLED') throw fault('ALREADY_CANCELLED', 'Cette réservation est déjà annulée.');
  await conn.query('SELECT id FROM availabilities WHERE id = ? FOR UPDATE', [r.availability_id]);
  await conn.query('UPDATE availabilities SET available_slots = available_slots + ? WHERE id = ?', [r.quantity, r.availability_id]);
  await conn.query("UPDATE reservations SET status = 'CANCELLED' WHERE id = ?", [r.id]);
  const [refunded] = await conn.query(
    "UPDATE payments SET status = 'REFUNDED' WHERE reservation_id = ? AND status = 'PAID'", [r.id]);
  if (refunded.affectedRows > 0) {
    await notify(conn, r.user_id, 'PAYMENT_REFUNDED', 'Paiement remboursé',
      `Le paiement de la réservation n°${r.id} a été remboursé.`);
  }
  if (r.promo_code) await releasePromo(conn, r.promo_code);
  const message = (CANCEL_MESSAGES[reason] || CANCEL_MESSAGES.user)(r.id);
  await notify(conn, r.user_id, 'RESERVATION_CANCELLED', 'Réservation annulée', message);
}

module.exports = { RESERVATION_SQL, SERVICE_SQL, SERVICE_JOIN, REVIEW_SQL, loadReservation, cancelReservationTx };
