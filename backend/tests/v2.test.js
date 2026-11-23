// Tests des fonctionnalités v2 : tableau de bord, favoris, avis, notifications,
// recherche avancée, codes promo, journal d'audit, historique des paiements.
// Même principe que flow.test.js : vrais appels SOAP contre la base réelle.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const soap = require('soap');
const config = require('../src/config');
const { pool } = require('../src/db');
const app = require('../server');

const NS = 'http://booking.example.com/soap';
const BASE = `http://localhost:${config.port}`;
let httpServer;
const clients = {};

const stamp = Date.now();
const email = `test.v2.${stamp}@example.com`;
const otherEmail = `test.v2.autre.${stamp}@example.com`;
let token;
let otherToken;
let adminToken;
let serviceId;
let availabilityId;
let reviewId;

/** node-soap renvoie un objet (1 élément) ou un tableau : on normalise toujours en tableau. */
const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const money = (n) => Math.round(Number(n) * 100) / 100;
const isoDate = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

before(async () => {
  const alive = await fetch(`${BASE}/health`).then((r) => r.ok).catch(() => false);
  if (!alive) await new Promise((resolve) => { httpServer = app.listen(config.port, resolve); });
  for (const name of ['user', 'availability', 'booking', 'payment', 'engagement', 'admin']) {
    clients[name] = await soap.createClientAsync(`${BASE}/soap/${name}?wsdl`);
  }

  // Deux comptes frais : le principal (avis, promos) et un second (contrôle des droits).
  await call('user', 'registerUser', { name: 'Test V2 Principal', email, password: 'Secret123' });
  token = (await call('user', 'loginUser', { email, password: 'Secret123' })).token;
  await call('user', 'registerUser', { name: 'Test V2 Autre', email: otherEmail, password: 'Secret123' });
  otherToken = (await call('user', 'loginUser', { email: otherEmail, password: 'Secret123' })).token;
  adminToken = (await call('user', 'loginUser', { email: 'admin@booking.tn', password: 'Admin123!' })).token;

  // Un service à nous, avec une date très lointaine : les tests ne touchent pas la démo.
  const { service } = await call('availability', 'createService',
    { name: `Test V2 Avis ${stamp}`, type: 'HOTEL', location: 'Tunis', price: 100 }, adminToken);
  serviceId = service.id;
  const { availability } = await call('availability', 'setAvailability',
    { serviceId, date: '2031-03-15', totalSlots: 60 }, adminToken);
  availabilityId = availability.id;
});

after(async () => {
  // Les réservations, avis, favoris et notifications partent en cascade avec les comptes.
  await pool.query("DELETE FROM users WHERE email LIKE 'test.v2.%@example.com'");
  await pool.query("DELETE FROM promo_codes WHERE code LIKE 'TEST%'");
  await pool.query("DELETE FROM services WHERE name LIKE 'Test V2 %'");
  await pool.end();
  if (httpServer) httpServer.close();
});

async function call(service, op, args = {}, authToken) {
  const client = clients[service];
  client.clearSoapHeaders();
  if (authToken) client.addSoapHeader({ AuthToken: authToken }, '', 'tns', NS);
  const [result] = await client[`${op}Async`](args);
  return result;
}

async function expectFault(promise, code) {
  await assert.rejects(promise, (err) => {
    const fault = err.root?.Envelope?.Body?.Fault;
    assert.ok(fault, `un SOAP Fault était attendu, reçu : ${err.message}`);
    assert.equal(fault.detail?.code, code, `code attendu ${code}, reçu ${fault.detail?.code} (${fault.faultstring})`);
    return true;
  });
}

/* ---------------- Favoris ---------------- */

test('favoris : ajout idempotent, liste, retrait, authentification exigée', async () => {
  await expectFault(call('engagement', 'getFavorites'), 'AUTH_REQUIRED');
  await call('engagement', 'addFavorite', { serviceId }, token);
  await call('engagement', 'addFavorite', { serviceId }, token); // idempotent : pas de doublon
  const favorites = await call('engagement', 'getFavorites', {}, token);
  assert.equal(arr(favorites.service).length, 1);
  assert.equal(arr(favorites.service)[0].id, serviceId);

  await expectFault(call('engagement', 'addFavorite', { serviceId: 999999 }, token), 'NOT_FOUND');

  await call('engagement', 'removeFavorite', { serviceId }, token);
  await call('engagement', 'removeFavorite', { serviceId }, token);
  // Réponse vide : node-soap renvoie null quand aucun élément enfant n'est présent.
  assert.equal(arr((await call('engagement', 'getFavorites', {}, token))?.service).length, 0);
});

/* ---------------- Avis ---------------- */

test('avis : réservation confirmée exigée, note moyenne, mise à jour, droits', async () => {
  // Sans réservation confirmée : refusé.
  await expectFault(call('engagement', 'saveReview', { serviceId, rating: 5 }, token), 'NOT_ELIGIBLE');

  const { reservation } = await call('booking', 'createReservation', { availabilityId, quantity: 2 }, token);
  await call('payment', 'createPayment', { reservationId: reservation.id, method: 'CARD' }, token);

  const { review } = await call('engagement', 'saveReview', { serviceId, rating: 5, comment: 'Très bien' }, token);
  reviewId = review.id;
  assert.equal(review.rating, 5);
  assert.equal(review.userName, 'Test V2 Principal');
  assert.equal(review.comment, 'Très bien');

  // Un seul avis par utilisateur et par service : la seconde note remplace la première.
  const updated = await call('engagement', 'saveReview', { serviceId, rating: 3, comment: 'Correct' }, token);
  assert.equal(updated.review.id, review.id);
  assert.equal(updated.review.rating, 3);

  const listed = await call('engagement', 'getServiceReviews', { serviceId });
  assert.equal(listed.reviewCount, 1);
  assert.equal(Number(listed.averageRating), 3);
  assert.equal(arr(listed.review)[0].comment, 'Correct');

  // La note remonte dans les réponses de service.
  const found = arr((await call('availability', 'searchServices', { keyword: `Test V2 Avis ${stamp}` })).service);
  assert.equal(found.length, 1);
  assert.equal(Number(found[0].averageRating), 3);
  assert.equal(Number(found[0].reviewCount), 1);

  // Validation de la note.
  await expectFault(call('engagement', 'saveReview', { serviceId, rating: 0 }, token), 'VALIDATION_ERROR');
  await expectFault(call('engagement', 'saveReview', { serviceId, rating: 6 }, token), 'VALIDATION_ERROR');

  // Seul l'auteur ou un administrateur peut supprimer un avis.
  await expectFault(call('engagement', 'deleteReview', { reviewId }, otherToken), 'FORBIDDEN');
  await call('engagement', 'deleteReview', { reviewId }, token);
  assert.equal(Number((await call('engagement', 'getServiceReviews', { serviceId })).reviewCount), 0);
  const restored = await call('engagement', 'saveReview', { serviceId, rating: 3, comment: 'Correct' }, token);
  reviewId = restored.review.id;
  await expectFault(call('admin', 'getAllReviews', {}, token), 'FORBIDDEN');
  const moderation = await call('admin', 'getAllReviews', { limit: 10, offset: 0 }, adminToken);
  assert.ok(arr(moderation.review).some((r) => r.id === reviewId));
  assert.ok(moderation.total >= 1);
});

/* ---------------- Recherche avancée ---------------- */

test('recherche avancée : tri, filtre de note, pagination et total', async () => {
  // Rétrocompatibilité : sans limit, tous les résultats et total cohérent.
  const all = await call('availability', 'searchServices', {});
  assert.equal(arr(all.service).length, all.total);

  const firstPage = await call('availability', 'searchServices', { limit: 2, offset: 0 });
  assert.equal(arr(firstPage.service).length, 2);
  const secondPage = await call('availability', 'searchServices', { limit: 2, offset: 2 });
  assert.equal(arr(secondPage.service).length, 2);
  assert.notEqual(arr(firstPage.service)[0].id, arr(secondPage.service)[0].id);

  const byPrice = await call('availability', 'searchServices', { sortBy: 'price_asc' });
  const prices = arr(byPrice.service).map((s) => Number(s.price));
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));

  const byRating = await call('availability', 'searchServices', { sortBy: 'rating' });
  assert.ok(arr(byRating.service).length > 0);

  // minRating : notre service est noté 3.
  const rated = arr((await call('availability', 'searchServices', { keyword: `Test V2 Avis ${stamp}`, minRating: 4 })).service);
  assert.equal(rated.length, 0);
  const rated3 = arr((await call('availability', 'searchServices', { keyword: `Test V2 Avis ${stamp}`, minRating: 3 })).service);
  assert.equal(rated3.length, 1);

  await expectFault(call('availability', 'searchServices', { sortBy: 'inconnu' }), 'VALIDATION_ERROR');
  await expectFault(call('availability', 'searchServices', { minRating: 9 }), 'VALIDATION_ERROR');
  await expectFault(call('availability', 'searchServices', { limit: 500 }), 'VALIDATION_ERROR');
});

/* ---------------- Codes promo ---------------- */

test('codes promo : droits, création, aperçu, application, quota, expiration, restitution', async () => {
  const code = `TEST${stamp}`.slice(0, 28);
  await expectFault(call('admin', 'createPromoCode',
    { code, percent: 20, validFrom: isoDate(0), validTo: isoDate(30) }, token), 'FORBIDDEN');

  const { promo } = await call('admin', 'createPromoCode',
    { code, percent: 20, validFrom: isoDate(0), validTo: isoDate(30), maxUses: 1 }, adminToken);
  assert.equal(promo.percent, 20);
  assert.ok(promo.active === true || String(promo.active) === 'true');
  assert.equal(Number(promo.usedCount), 0);

  // Doublon et date incohérente refusés.
  await expectFault(call('admin', 'createPromoCode',
    { code, percent: 10, validFrom: isoDate(0), validTo: isoDate(30) }, adminToken), 'DUPLICATE');
  await expectFault(call('admin', 'createPromoCode',
    { code: `TESTINV${stamp}`.slice(0, 28), percent: 10, validFrom: isoDate(10), validTo: isoDate(1) }, adminToken), 'VALIDATION_ERROR');

  // Aperçu (casse indifférente).
  const preview = await call('engagement', 'checkPromoCode', { code: code.toLowerCase() }, token);
  assert.equal(Number(preview.percent), 20);
  await expectFault(call('engagement', 'checkPromoCode', { code: `TESTINCONNU${stamp}`.slice(0, 28) }, token), 'PROMO_INVALID');

  // Application : 2 × 100 = 200, remise 40, total 160.
  const withPromo = await call('booking', 'createReservation', { availabilityId, quantity: 2, promoCode: code }, token);
  assert.equal(withPromo.reservation.totalPrice, 160);
  assert.equal(withPromo.reservation.discountAmount, 40);
  assert.equal(withPromo.reservation.promoCode, code);

  // Quota atteint (maxUses = 1).
  await expectFault(call('booking', 'createReservation', { availabilityId, quantity: 1, promoCode: code }, token), 'PROMO_EXHAUSTED');

  // Code périmé.
  const old = await call('admin', 'createPromoCode',
    { code: `TESTOld${stamp}`.slice(0, 28), percent: 10, validFrom: '2020-01-01', validTo: '2020-01-02' }, adminToken);
  await expectFault(call('booking', 'createReservation',
    { availabilityId, quantity: 1, promoCode: old.promo.code }, token), 'PROMO_EXPIRED');

  // L'annulation restitue l'utilisation : le code redevient disponible.
  await call('booking', 'cancelReservation', { reservationId: withPromo.reservation.id }, token);
  assert.equal(Number((await call('engagement', 'checkPromoCode', { code }, token)).percent), 20);
  const again = await call('booking', 'createReservation', { availabilityId, quantity: 1, promoCode: code }, token);
  assert.equal(again.reservation.totalPrice, 80);

  // Désactivation par l'admin : le code est refusé.
  const off = await call('admin', 'setPromoCodeActive', { promoCodeId: promo.id, active: false }, adminToken);
  assert.ok(off.promo.active === false || String(off.promo.active) === 'false');
  await expectFault(call('booking', 'createReservation', { availabilityId, quantity: 1, promoCode: code }, token), 'PROMO_INVALID');

  const list = await call('admin', 'listPromoCodes', {}, adminToken);
  assert.ok(arr(list.promo).some((p) => p.code === code));

  await call('admin', 'deletePromoCode', { promoCodeId: promo.id }, adminToken);
  await expectFault(call('admin', 'deletePromoCode', { promoCodeId: promo.id }, adminToken), 'NOT_FOUND');
  await call('admin', 'deletePromoCode', { promoCodeId: old.promo.id }, adminToken);
  await call('booking', 'cancelReservation', { reservationId: again.reservation.id }, token);
});

test('modification de quantité : la remise suit le pourcentage du code promo', async () => {
  const code = `TESTUPD${stamp}`.slice(0, 28);
  const { promo } = await call('admin', 'createPromoCode',
    { code, percent: 25, validFrom: isoDate(0), validTo: isoDate(30) }, adminToken);

  const created = await call('booking', 'createReservation', { availabilityId, quantity: 2, promoCode: code }, token);
  assert.equal(created.reservation.totalPrice, 150); // 200 - 25 %
  const updated = await call('booking', 'updateReservation', { reservationId: created.reservation.id, quantity: 4 }, token);
  assert.equal(updated.reservation.totalPrice, 300); // 400 - 25 %
  assert.equal(updated.reservation.discountAmount, 100);
  assert.equal(updated.reservation.quantity, 4);

  // Quantité supérieure au stock disponible : refus explicite.
  await expectFault(call('booking', 'updateReservation', { reservationId: created.reservation.id, quantity: 500 }, token), 'VALIDATION_ERROR');
  await call('booking', 'cancelReservation', { reservationId: created.reservation.id }, token);
  await call('admin', 'deletePromoCode', { promoCodeId: promo.id }, adminToken);
});

/* ---------------- Notifications ---------------- */

test('notifications : créées par les actions, compteur, lecture unitaire et globale', async () => {
  await expectFault(call('engagement', 'getMyNotifications'), 'AUTH_REQUIRED');
  const all = await call('engagement', 'getMyNotifications', {}, token);
  assert.ok(Number(all.unreadCount) >= 1);
  assert.ok(arr(all.notification).some((n) => n.type === 'RESERVATION_CREATED'));
  assert.ok(arr(all.notification).some((n) => n.type === 'PAYMENT_ACCEPTED'));

  const unread = await call('engagement', 'getMyNotifications', { unreadOnly: true }, token);
  assert.ok(arr(unread.notification).every((n) => String(n.isRead) !== 'true'));

  const first = arr(all.notification)[0];
  const read = await call('engagement', 'markNotificationRead', { notificationId: first.id }, token);
  assert.ok(read.notification);
  const afterOne = await call('engagement', 'getMyNotifications', {}, token);
  assert.ok(Number(afterOne.unreadCount) < Number(all.unreadCount));

  await call('engagement', 'markAllNotificationsRead', {}, token);
  assert.equal(Number((await call('engagement', 'getMyNotifications', {}, token)).unreadCount), 0);

  // La notification d'un autre utilisateur reste inaccessible.
  const mine = arr((await call('engagement', 'getMyNotifications', {}, token)).notification)[0];
  await expectFault(call('engagement', 'markNotificationRead', { notificationId: mine.id }, otherToken), 'NOT_FOUND');
});

/* ---------------- Paiements et facture ---------------- */

test('mes paiements : liste enrichie (service et date), authentification exigée', async () => {
  await expectFault(call('payment', 'getMyPayments'), 'AUTH_REQUIRED');
  const mine = await call('payment', 'getMyPayments', {}, token);
  assert.ok(arr(mine.payment).length >= 1);
  const paid = arr(mine.payment).find((p) => p.status === 'PAID');
  assert.ok(paid, 'un paiement PAID est attendu');
  assert.equal(paid.serviceName, `Test V2 Avis ${stamp}`);
  assert.equal(paid.date, '2031-03-15');

  // L'autre compte ne voit aucun de ces paiements.
  assert.equal(arr((await call('payment', 'getMyPayments', {}, otherToken))?.payment).length, 0);
});

/* ---------------- Tableau de bord ---------------- */

test('tableau de bord : droits, validation de days, cohérence des compteurs et du revenu', async () => {
  await expectFault(call('admin', 'getDashboardStats'), 'AUTH_REQUIRED');
  await expectFault(call('admin', 'getDashboardStats', {}, token), 'FORBIDDEN');
  await expectFault(call('admin', 'getDashboardStats', { days: 14 }, adminToken), 'VALIDATION_ERROR');

  const before = (await call('admin', 'getDashboardStats', { days: 30 }, adminToken)).dashboard;
  assert.equal(arr(before.daily).length, 30);
  assert.equal(arr(before.byType).length, 3);
  assert.equal(arr(before.byMethod).length, 3);

  const { reservation } = await call('booking', 'createReservation', { availabilityId, quantity: 1 }, token);
  const { payment } = await call('payment', 'createPayment', { reservationId: reservation.id, method: 'PAYPAL' }, token);
  assert.equal(payment.amount, 100);

  const after = (await call('admin', 'getDashboardStats', { days: 30 }, adminToken)).dashboard;
  assert.equal(Number(after.kpis.totalReservations), Number(before.kpis.totalReservations) + 1);
  assert.equal(money(after.kpis.revenue - before.kpis.revenue), 100);
  assert.equal(Number(after.kpis.reservationsInPeriod), Number(before.kpis.reservationsInPeriod) + 1);
  assert.ok(arr(after.recent).some((r) => r.id === reservation.id));
  assert.ok(arr(after.topServices).length >= 1);
  assert.ok(arr(after.lowAvailability).length <= 10);
  assert.equal(arr((await call('admin', 'getDashboardStats', { days: 7 }, adminToken)).dashboard.daily).length, 7);
  assert.equal(arr((await call('admin', 'getDashboardStats', { days: 90 }, adminToken)).dashboard.daily).length, 90);

  // Remboursement : le revenu revient à son niveau initial, le remboursement est compté à part.
  await call('payment', 'refundPayment', { paymentId: payment.id }, adminToken);
  const refunded = (await call('admin', 'getDashboardStats', { days: 30 }, adminToken)).dashboard;
  assert.equal(money(refunded.kpis.revenue), money(before.kpis.revenue));
  assert.ok(money(refunded.kpis.refundedAmount) >= 100);
  assert.ok(money(refunded.kpis.averageBasket) >= 0);
  assert.ok(Number(refunded.kpis.occupancyRate) >= 0 && Number(refunded.kpis.occupancyRate) <= 100);
});

/* ---------------- Journal d'audit ---------------- */

test('journal d\'audit : réservé aux admins, alimenté par les actions', async () => {
  await expectFault(call('admin', 'getAuditLog', {}, token), 'FORBIDDEN');
  const log = await call('admin', 'getAuditLog', { limit: 100 }, adminToken);
  const actions = arr(log.entry).map((e) => e.action);
  for (const expected of ['CREATE_SERVICE', 'SET_AVAILABILITY', 'CREATE_PROMO', 'REFUND_PAYMENT']) {
    assert.ok(actions.includes(expected), `action ${expected} absente du journal (${actions.join(', ')})`);
  }
  assert.ok(arr(log.entry).every((e) => e.createdAt));
  assert.ok(Number(log.total) >= arr(log.entry).length);
  // Les entrées les plus récentes d'abord.
  const dates = arr(log.entry).map((e) => e.createdAt);
  assert.deepEqual(dates, [...dates].sort().reverse());
});

/* ---------------- Modération des avis ---------------- */

test('modération : l\'admin supprime un avis et l\'action est tracée', async () => {
  await call('engagement', 'deleteReview', { reviewId }, adminToken);
  const listed = await call('engagement', 'getServiceReviews', { serviceId });
  assert.equal(Number(listed.reviewCount), 0);
  const log = await call('admin', 'getAuditLog', { limit: 20 }, adminToken);
  assert.ok(arr(log.entry).some((e) => e.action === 'DELETE_REVIEW'));
});
