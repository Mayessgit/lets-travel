// EngagementService : favoris, avis, notifications, aperçu des codes promo.
// Toutes les opérations sont authentifiées et ne concernent que l'utilisateur du token.
const { pool } = require('../db');
const { fault } = require('../errors');
const V = require('../validators');
const { requireAuth } = require('../auth');
const { toService, toReview, toNotification } = require('../mappers');
const { SERVICE_JOIN, REVIEW_SQL } = require('../domain');
const { audit } = require('../audit');
const { loadPromo } = require('../promo');

const round2 = (n) => Math.round(n * 100) / 100;

// ---------- Favoris ----------

async function addFavorite(args, headers) {
  const auth = await requireAuth(headers);
  const serviceId = V.int(args.serviceId, 'serviceId');
  const [rows] = await pool.query('SELECT id FROM services WHERE id = ?', [serviceId]);
  if (rows.length === 0) throw fault('NOT_FOUND', 'Service introuvable.');
  // Idempotent : ajouter deux fois le même favori ne change rien.
  await pool.query('INSERT IGNORE INTO favorites (user_id, service_id) VALUES (?, ?)', [auth.id, serviceId]);
  return { message: 'Service ajouté à vos favoris.' };
}

async function removeFavorite(args, headers) {
  const auth = await requireAuth(headers);
  const serviceId = V.int(args.serviceId, 'serviceId');
  await pool.query('DELETE FROM favorites WHERE user_id = ? AND service_id = ?', [auth.id, serviceId]);
  return { message: 'Service retiré de vos favoris.' };
}

async function getFavorites(_args, headers) {
  const auth = await requireAuth(headers);
  const [rows] = await pool.query(
    `SELECT s.*, rev.avg_rating, rev.review_count
     FROM favorites f
     JOIN services s ON s.id = f.service_id${SERVICE_JOIN}
     WHERE f.user_id = ? ORDER BY s.name`, [auth.id]);
  return { service: rows.map(toService) };
}

// ---------- Avis ----------

async function saveReview(args, headers) {
  const auth = await requireAuth(headers);
  const serviceId = V.int(args.serviceId, 'serviceId');
  const rating = V.intRange(args.rating, 'rating', 1, 5);
  const comment = V.str(args.comment, 'comment', { max: 1000, required: false }) ?? null;

  const [svc] = await pool.query('SELECT id FROM services WHERE id = ?', [serviceId]);
  if (svc.length === 0) throw fault('NOT_FOUND', 'Service introuvable.');

  // Règle : seul un client ayant une réservation CONFIRMED pour ce service peut le noter.
  const [eligible] = await pool.query(
    "SELECT id FROM reservations WHERE user_id = ? AND service_id = ? AND status = 'CONFIRMED' LIMIT 1",
    [auth.id, serviceId]);
  if (eligible.length === 0) {
    throw fault('NOT_ELIGIBLE', 'Vous pourrez noter ce service après une réservation confirmée.');
  }

  // Un seul avis par utilisateur et par service : la nouvelle note remplace l'ancienne.
  await pool.query(
    `INSERT INTO reviews (user_id, service_id, rating, comment) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = VALUES(comment), updated_at = CURRENT_TIMESTAMP`,
    [auth.id, serviceId, rating, comment]);
  const [rows] = await pool.query(`${REVIEW_SQL} WHERE rv.user_id = ? AND rv.service_id = ?`, [auth.id, serviceId]);
  return { review: toReview(rows[0]) };
}

async function deleteReview(args, headers) {
  const auth = await requireAuth(headers);
  const id = V.int(args.reviewId, 'reviewId');
  const [rows] = await pool.query('SELECT * FROM reviews WHERE id = ?', [id]);
  if (rows.length === 0) throw fault('NOT_FOUND', 'Avis introuvable.');
  if (auth.role !== 'ADMIN' && auth.id !== rows[0].user_id) {
    throw fault('FORBIDDEN', 'Accès refusé à cette ressource.');
  }
  await pool.query('DELETE FROM reviews WHERE id = ?', [id]);
  if (auth.role === 'ADMIN' && auth.id !== rows[0].user_id) {
    await audit(pool, auth.id, 'DELETE_REVIEW', 'REVIEW', id, `service #${rows[0].service_id}`);
  }
  return { message: 'Avis supprimé.' };
}

/** Avis publics d'un service (pas d'avatar : on n'expose pas les photos dans une liste). */
async function getServiceReviews(args) {
  const serviceId = V.int(args.serviceId, 'serviceId');
  const limit = V.intRange(args.limit, 'limit', 1, 50, { required: false }) ?? 10;
  const offset = V.int(args.offset, 'offset', { min: 0, required: false }) ?? 0;

  const [stats] = await pool.query(
    'SELECT COUNT(*) AS n, COALESCE(AVG(rating), 0) AS avg FROM reviews WHERE service_id = ?', [serviceId]);
  const [rows] = await pool.query(
    `${REVIEW_SQL} WHERE rv.service_id = ? ORDER BY rv.updated_at DESC, rv.id DESC LIMIT ? OFFSET ?`,
    [serviceId, limit, offset]);
  return {
    review: rows.map(toReview),
    averageRating: round2(Number(stats[0].avg)),
    reviewCount: Number(stats[0].n),
  };
}

// ---------- Notifications ----------

async function getMyNotifications(args, headers) {
  const auth = await requireAuth(headers);
  const unreadOnly = V.bool(args.unreadOnly);
  const limit = V.intRange(args.limit, 'limit', 1, 100, { required: false }) ?? 20;
  const [rows] = await pool.query(
    `SELECT * FROM notifications WHERE user_id = ? ${unreadOnly ? 'AND is_read = 0' : ''}
     ORDER BY created_at DESC, id DESC LIMIT ?`, [auth.id, limit]);
  const [unread] = await pool.query(
    'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', [auth.id]);
  return { notification: rows.map(toNotification), unreadCount: Number(unread[0].n) };
}

async function markNotificationRead(args, headers) {
  const auth = await requireAuth(headers);
  const id = V.int(args.notificationId, 'notificationId');
  const [rows] = await pool.query('SELECT * FROM notifications WHERE id = ? AND user_id = ?', [id, auth.id]);
  if (rows.length === 0) throw fault('NOT_FOUND', 'Notification introuvable.');
  await pool.query('UPDATE notifications SET is_read = 1 WHERE id = ?', [id]);
  return { notification: toNotification({ ...rows[0], is_read: 1 }) };
}

async function markAllNotificationsRead(_args, headers) {
  const auth = await requireAuth(headers);
  const [result] = await pool.query('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [auth.id]);
  return { message: 'Notifications marquées comme lues.', updated: result.affectedRows };
}

// ---------- Code promo (aperçu du prix) ----------

async function checkPromoCode(args, headers) {
  await requireAuth(headers);
  const code = V.promoCode(args.code);
  if (code === undefined) throw fault('VALIDATION_ERROR', 'Le champ "code" est obligatoire.');
  const promo = await loadPromo(pool, code);
  return { code: promo.code, percent: Number(promo.percent) };
}

module.exports = {
  addFavorite, removeFavorite, getFavorites,
  saveReview, deleteReview, getServiceReviews,
  getMyNotifications, markNotificationRead, markAllNotificationsRead,
  checkPromoCode,
};
