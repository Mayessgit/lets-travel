// AdminService : tableau de bord, journal d'audit, modération des avis, codes promo.
// Toutes les opérations sont réservées aux administrateurs (requireAdmin).
const { pool } = require('../db');
const { fault } = require('../errors');
const V = require('../validators');
const { requireAdmin } = require('../auth');
const { toReservation, toReview, toPromo, toAuditEntry } = require('../mappers');
const { RESERVATION_SQL, REVIEW_SQL } = require('../domain');
const { audit } = require('../audit');

const DAYS_ALLOWED = [7, 30, 90];
const round2 = (n) => Math.round(Number(n) * 100) / 100;

/** Liste des jours de la période, du plus ancien à aujourd'hui (les jours vides restent présents). */
function dayList(days) {
  const out = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return out;
}

async function loadPromoRow(id, conn = pool) {
  const [rows] = await conn.query('SELECT * FROM promo_codes WHERE id = ?', [id]);
  if (rows.length === 0) throw fault('NOT_FOUND', 'Code promo introuvable.');
  return rows[0];
}

/* ---------------- Tableau de bord ---------------- */

async function getDashboardStats(args, headers) {
  await requireAdmin(headers);
  const days = V.int(args.days, 'days', { required: false }) ?? 30;
  if (!DAYS_ALLOWED.includes(days)) throw fault('VALIDATION_ERROR', '"days" doit valoir 7, 30 ou 90.');
  const span = days - 1;       // aujourd'hui inclus
  const prevSpan = 2 * days - 1; // début de la période précédente

  // Une requête par agrégat : aucune boucle par ligne.
  const [users] = await pool.query(
    `SELECT COUNT(*) AS totalUsers,
            COALESCE(SUM(created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)), 0) AS newUsers
     FROM users`, [span]);

  const [services] = await pool.query('SELECT COUNT(*) AS totalServices FROM services');

  const [reservations] = await pool.query(
    `SELECT COUNT(*) AS totalReservations,
            COALESCE(SUM(status = 'PENDING'), 0) AS pendingReservations,
            COALESCE(SUM(status = 'CONFIRMED'), 0) AS confirmedReservations,
            COALESCE(SUM(status = 'CANCELLED'), 0) AS cancelledReservations,
            COALESCE(SUM(created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)), 0) AS reservationsInPeriod,
            COALESCE(SUM(created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                     AND created_at < DATE_SUB(CURDATE(), INTERVAL ? DAY)), 0) AS previousReservations
     FROM reservations`, [span, prevSpan, span]);

  // Les REFUNDED sont exclus du revenu ; ils sont comptés à part.
  const [payments] = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'PAID' AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                         THEN amount END), 0) AS revenue,
       COALESCE(SUM(CASE WHEN status = 'PAID' AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                          AND created_at < DATE_SUB(CURDATE(), INTERVAL ? DAY) THEN amount END), 0) AS previousRevenue,
       COALESCE(SUM(CASE WHEN status = 'REFUNDED' AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                         THEN amount END), 0) AS refundedAmount,
       COALESCE(AVG(CASE WHEN status = 'PAID' AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                         THEN amount END), 0) AS averageBasket
     FROM payments`, [span, prevSpan, span, span, span]);

  const [occupancy] = await pool.query(
    `SELECT COALESCE(SUM(total_slots), 0) AS slots,
            COALESCE(SUM(total_slots - available_slots), 0) AS booked
     FROM availabilities WHERE date >= CURDATE()`);

  // Séries quotidiennes : deux requêtes groupées + un remplissage en mémoire (jours à zéro inclus).
  const [dailyReservations] = await pool.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS d, COUNT(*) AS n
     FROM reservations WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY) GROUP BY d`, [span]);
  const [dailyRevenue] = await pool.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS d, COALESCE(SUM(amount), 0) AS s
     FROM payments WHERE status = 'PAID' AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY) GROUP BY d`, [span]);
  const resByDay = new Map(dailyReservations.map((r) => [r.d, Number(r.n)]));
  const revByDay = new Map(dailyRevenue.map((r) => [r.d, Number(r.s)]));
  const daily = dayList(days).map((date) => ({
    date,
    reservations: resByDay.get(date) || 0,
    revenue: round2(revByDay.get(date) || 0),
  }));

  const [types] = await pool.query(
    `SELECT s.type, COUNT(r.id) AS reservations, COALESCE(SUM(r.total_price), 0) AS revenue
     FROM reservations r JOIN services s ON s.id = r.service_id
     WHERE r.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY s.type`, [span]);
  const typeMap = new Map(types.map((t) => [t.type, t]));
  const byType = V.SERVICE_TYPES.map((type) => ({
    type,
    reservations: Number(typeMap.get(type)?.reservations || 0),
    revenue: round2(typeMap.get(type)?.revenue || 0),
  }));

  const [methods] = await pool.query(
    `SELECT method, COUNT(*) AS payments, COALESCE(SUM(amount), 0) AS amount
     FROM payments WHERE status = 'PAID' AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY method`, [span]);
  const methodMap = new Map(methods.map((m) => [m.method, m]));
  const byMethod = V.PAYMENT_METHODS.map((method) => ({
    method,
    payments: Number(methodMap.get(method)?.payments || 0),
    amount: round2(methodMap.get(method)?.amount || 0),
  }));

  const [top] = await pool.query(
    `SELECT s.id AS serviceId, s.name, s.type, COUNT(*) AS reservations, COALESCE(SUM(r.total_price), 0) AS revenue
     FROM reservations r JOIN services s ON s.id = r.service_id
     WHERE r.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY s.id, s.name, s.type
     ORDER BY reservations DESC, revenue DESC
     LIMIT 5`, [span]);
  const topServices = top.map((t) => ({
    serviceId: t.serviceId, name: t.name, type: t.type,
    reservations: Number(t.reservations), revenue: round2(t.revenue),
  }));

  // Dates à venir (30 jours) dont il reste 20 % de places ou moins.
  const [low] = await pool.query(
    `SELECT a.service_id AS serviceId, s.name AS serviceName, a.date,
            a.available_slots AS availableSlots, a.total_slots AS totalSlots
     FROM availabilities a JOIN services s ON s.id = a.service_id
     WHERE a.date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
       AND a.total_slots > 0 AND a.available_slots <= a.total_slots * 0.2
     ORDER BY (a.available_slots / a.total_slots), a.date
     LIMIT 10`);
  const lowAvailability = low.map((l) => ({
    serviceId: l.serviceId, serviceName: l.serviceName, date: l.date,
    availableSlots: Number(l.availableSlots), totalSlots: Number(l.totalSlots),
  }));

  const [recentRows] = await pool.query(
    `${RESERVATION_SQL} ORDER BY r.created_at DESC, r.id DESC LIMIT 8`);

  const slots = Number(occupancy[0].slots);
  const booked = Number(occupancy[0].booked);

  return {
    dashboard: {
      kpis: {
        totalUsers: Number(users[0].totalUsers),
        newUsers: Number(users[0].newUsers),
        totalServices: Number(services[0].totalServices),
        totalReservations: Number(reservations[0].totalReservations),
        pendingReservations: Number(reservations[0].pendingReservations),
        confirmedReservations: Number(reservations[0].confirmedReservations),
        cancelledReservations: Number(reservations[0].cancelledReservations),
        revenue: round2(payments[0].revenue),
        previousRevenue: round2(payments[0].previousRevenue),
        reservationsInPeriod: Number(reservations[0].reservationsInPeriod),
        previousReservations: Number(reservations[0].previousReservations),
        refundedAmount: round2(payments[0].refundedAmount),
        averageBasket: round2(payments[0].averageBasket),
        occupancyRate: slots > 0 ? Math.round((booked / slots) * 1000) / 10 : 0,
      },
      daily,
      byType,
      byMethod,
      topServices,
      lowAvailability,
      recent: recentRows.map(toReservation),
    },
  };
}

/* ---------------- Journal d'audit ---------------- */

async function getAuditLog(args, headers) {
  await requireAdmin(headers);
  const limit = V.intRange(args.limit, 'limit', 1, 200, { required: false }) ?? 50;
  const offset = V.int(args.offset, 'offset', { min: 0, required: false }) ?? 0;
  const [rows] = await pool.query(
    `SELECT al.*, u.name AS admin_name
     FROM audit_logs al LEFT JOIN users u ON u.id = al.admin_id
     ORDER BY al.created_at DESC, al.id DESC LIMIT ? OFFSET ?`, [limit, offset]);
  const [count] = await pool.query('SELECT COUNT(*) AS n FROM audit_logs');
  return { entry: rows.map(toAuditEntry), total: Number(count[0].n) };
}

/* ---------------- Modération des avis ---------------- */

async function getAllReviews(args, headers) {
  await requireAdmin(headers);
  const limit = V.intRange(args.limit, 'limit', 1, 200, { required: false }) ?? 50;
  const offset = V.int(args.offset, 'offset', { min: 0, required: false }) ?? 0;
  const [rows] = await pool.query(
    `${REVIEW_SQL} ORDER BY rv.updated_at DESC, rv.id DESC LIMIT ? OFFSET ?`, [limit, offset]);
  const [count] = await pool.query('SELECT COUNT(*) AS n FROM reviews');
  return { review: rows.map(toReview), total: Number(count[0].n) };
}

/* ---------------- Codes promo ---------------- */

async function createPromoCode(args, headers) {
  const auth = await requireAdmin(headers);
  const code = V.promoCode(args.code);
  if (code === undefined) throw fault('VALIDATION_ERROR', 'Le champ "code" est obligatoire.');
  const percent = V.intRange(args.percent, 'percent', 1, 100);
  const validFrom = V.date(args.validFrom, 'validFrom');
  const validTo = V.date(args.validTo, 'validTo');
  if (validTo < validFrom) throw fault('VALIDATION_ERROR', '"validTo" doit être postérieure ou égale à "validFrom".');
  const maxUses = V.int(args.maxUses, 'maxUses', { min: 1, required: false }) ?? null;
  const active = V.opt(args.active) === undefined ? true : V.bool(args.active);

  const [exists] = await pool.query('SELECT id FROM promo_codes WHERE code = ?', [code]);
  if (exists.length > 0) throw fault('DUPLICATE', 'Ce code promo existe déjà.');

  const [result] = await pool.query(
    'INSERT INTO promo_codes (code, percent, valid_from, valid_to, max_uses, active) VALUES (?, ?, ?, ?, ?, ?)',
    [code, percent, validFrom, validTo, maxUses, active ? 1 : 0]);
  await audit(pool, auth.id, 'CREATE_PROMO', 'PROMO', result.insertId, `${code} : -${percent} %`);
  return { promo: toPromo(await loadPromoRow(result.insertId)) };
}

async function listPromoCodes(_args, headers) {
  await requireAdmin(headers);
  const [rows] = await pool.query('SELECT * FROM promo_codes ORDER BY created_at DESC, id DESC');
  return { promo: rows.map(toPromo) };
}

async function setPromoCodeActive(args, headers) {
  const auth = await requireAdmin(headers);
  const id = V.int(args.promoCodeId, 'promoCodeId');
  if (V.opt(args.active) === undefined) throw fault('VALIDATION_ERROR', 'Le champ "active" est obligatoire.');
  const active = V.bool(args.active);
  await loadPromoRow(id);
  await pool.query('UPDATE promo_codes SET active = ? WHERE id = ?', [active ? 1 : 0, id]);
  await audit(pool, auth.id, 'SET_PROMO_ACTIVE', 'PROMO', id, active ? 'activé' : 'désactivé');
  return { promo: toPromo(await loadPromoRow(id)) };
}

async function deletePromoCode(args, headers) {
  const auth = await requireAdmin(headers);
  const id = V.int(args.promoCodeId, 'promoCodeId');
  const promo = await loadPromoRow(id);
  await pool.query('DELETE FROM promo_codes WHERE id = ?', [id]);
  await audit(pool, auth.id, 'DELETE_PROMO', 'PROMO', id, promo.code);
  return { message: 'Code promo supprimé.' };
}

module.exports = {
  getDashboardStats, getAuditLog, getAllReviews,
  createPromoCode, listPromoCodes, setPromoCodeActive, deletePromoCode,
};
