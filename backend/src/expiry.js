// Expiration des réservations non payées : après RESERVATION_TTL_MINUTES (15 par défaut),
// une réservation PENDING est annulée et ses places sont restituées au stock.
const { pool, withTransaction } = require('./db');
const { cancelReservationTx } = require('./domain');
const { reservationTtlMinutes } = require('./config');

/** Annule les réservations PENDING trop anciennes ; renvoie leur nombre. */
async function expirePendingReservations() {
  const [rows] = await pool.query(
    "SELECT id FROM reservations WHERE status = 'PENDING' AND created_at < (NOW() - INTERVAL ? MINUTE)",
    [reservationTtlMinutes]);

  let expired = 0;
  for (const { id } of rows) {
    await withTransaction(async (conn) => {
      // On reverrouille la ligne et on revérifie le statut : un paiement a pu aboutir entre-temps.
      const [r] = await conn.query("SELECT * FROM reservations WHERE id = ? AND status = 'PENDING' FOR UPDATE", [id]);
      if (r.length === 0) return;
      await cancelReservationTx(conn, r[0], 'expired'); // raison « expirée » : message dédié
      expired += 1;
    });
  }
  return expired;
}

/** Lance la vérification au démarrage puis toutes les minutes. */
function startExpiryJob(intervalMs = 60_000) {
  const run = () => expirePendingReservations()
    .then((n) => { if (n > 0) console.log(`[expiration] ${n} réservation(s) non payée(s) annulée(s)`); })
    .catch((err) => console.error('[expiration] erreur :', err.message));
  run();
  return setInterval(run, intervalMs).unref();
}

module.exports = { expirePendingReservations, startExpiryJob };
