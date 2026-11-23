// Test d'intégration : appelle réellement le service SOAP (client node-soap).
// Prérequis : MySQL démarré avec la base importée (database/schema.sql). Lancer : npm test
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

before(async () => {
  const alive = await fetch(`${BASE}/health`).then((r) => r.ok).catch(() => false);
  if (!alive) await new Promise((resolve) => { httpServer = app.listen(config.port, resolve); });
  for (const name of ['user', 'availability', 'booking', 'payment']) {
    clients[name] = await soap.createClientAsync(`${BASE}/soap/${name}?wsdl`);
  }
});

after(async () => {
  // Nettoyage des données créées par ce test (comptes de test d'abord : leurs réservations sont supprimées en cascade)
  await pool.query("DELETE FROM users WHERE email LIKE 'test.%@example.com'");
  await pool.query("DELETE FROM services WHERE name LIKE 'Test %'");
  await pool.end();
  if (httpServer) httpServer.close();
});

/** Appelle une opération SOAP, avec le JWT dans l'en-tête AuthToken si fourni. */
async function call(service, op, args = {}, token) {
  const client = clients[service];
  client.clearSoapHeaders();
  if (token) client.addSoapHeader({ AuthToken: token }, '', 'tns', NS);
  const [result] = await client[`${op}Async`](args);
  return result;
}

/** Vérifie qu'un appel échoue avec un SOAP Fault portant le code attendu. */
async function expectFault(promise, code) {
  await assert.rejects(promise, (err) => {
    const fault = err.root?.Envelope?.Body?.Fault;
    assert.ok(fault, `un SOAP Fault était attendu, reçu : ${err.message}`);
    assert.equal(fault.detail?.code, code, `code attendu ${code}, reçu ${fault.detail?.code} (${fault.faultstring})`);
    return true;
  });
}

const email = `test.${Date.now()}@example.com`;
let token, adminToken, availability, reservationId;

test('inscription, doublon et validation', async () => {
  const { user } = await call('user', 'registerUser', { name: 'Test Utilisateur', email, password: 'Secret123', phone: '55555555' });
  assert.equal(user.email, email);
  assert.equal(user.role, 'USER');
  await expectFault(call('user', 'registerUser', { name: 'Test', email, password: 'Secret123' }), 'EMAIL_EXISTS');
  await expectFault(call('user', 'registerUser', { name: 'Test', email: 'x@y.com', password: 'court' }), 'VALIDATION_ERROR');
});

test('connexion : bon et mauvais mot de passe', async () => {
  await expectFault(call('user', 'loginUser', { email, password: 'Mauvais123' }), 'BAD_CREDENTIALS');
  const res = await call('user', 'loginUser', { email, password: 'Secret123' });
  assert.ok(res.token);
  token = res.token;
  adminToken = (await call('user', 'loginUser', { email: 'admin@booking.tn', password: 'Admin123!' })).token;
});

test('recherche de services et disponibilités (public)', async () => {
  const all = await call('availability', 'getAllServices');
  assert.ok(all.service.length >= 6);
  const hotels = await call('availability', 'searchServices', { type: 'HOTEL', maxPrice: 150 });
  assert.deepEqual(hotels.service.map((s) => s.name), ['Hôtel Sousse Beach']);

  // Créneau d'exemple : Hôtel Tunis Palace, 30 places (date relative dans le schéma).
  // On ne fige pas le nombre de places restantes : la base de démo peut avoir de vraies réservations.
  const [sample] = await pool.query(
    "SELECT DATE_FORMAT(`date`, '%Y-%m-%d') AS d FROM availabilities WHERE service_id = 1 AND total_slots = 30 AND available_slots >= 2 ORDER BY `date` LIMIT 1");
  assert.equal(sample.length, 1, 'le jeu de démo doit avoir un créneau de 30 places pour l\'hôtel 1');
  const check = await call('availability', 'checkAvailability', { serviceId: 1, date: sample[0].d, quantity: 2 });
  assert.equal(check.available, true);
  assert.equal(check.availability.totalSlots, 30);

  const none = await call('availability', 'checkAvailability', { serviceId: 1, date: '2030-01-01' });
  assert.equal(none.available, false);

  const slots = await call('availability', 'getAvailableSlots', { serviceId: 3 });
  availability = slots.availability[0];
  assert.ok(availability.availableSlots >= 5);
});

test('règle 1 : réservation impossible sans authentification', async () => {
  await expectFault(call('booking', 'createReservation', { availabilityId: availability.id, quantity: 1 }), 'AUTH_REQUIRED');
  await expectFault(call('booking', 'createReservation', { availabilityId: availability.id, quantity: 1 }, 'faux.token'), 'INVALID_TOKEN');
});

test('règles 2 et 5 : réservation et décrément du stock', async () => {
  const before = availability.availableSlots;
  const { reservation } = await call('booking', 'createReservation', { availabilityId: availability.id, quantity: 2 }, token);
  reservationId = reservation.id;
  assert.equal(reservation.status, 'PENDING');
  assert.equal(reservation.quantity, 2);
  assert.equal(reservation.totalPrice, 620); // 2 x 310 (Vol Tunis - Paris)

  const after = await call('availability', 'checkAvailability', { serviceId: availability.serviceId, date: availability.date });
  assert.equal(after.availableSlots, before - 2);

  // Règle 2 : demander une place de plus que le stock restant est refusé
  const hotelSlots = (await call('availability', 'getAvailableSlots', { serviceId: 2 })).availability[0];
  await expectFault(call('booking', 'createReservation',
    { availabilityId: hotelSlots.id, quantity: hotelSlots.availableSlots + 1 }, token), 'NOT_ENOUGH_SLOTS');
});

test('modification de quantité tant que la réservation est en attente', async () => {
  const { reservation } = await call('booking', 'updateReservation', { reservationId, quantity: 3 }, token);
  assert.equal(reservation.totalPrice, 930);
  const back = await call('booking', 'updateReservation', { reservationId, quantity: 2 }, token);
  assert.equal(back.reservation.totalPrice, 620);
});

test('règle 3 : paiement échoué puis réussi, la réservation devient CONFIRMED', async () => {
  const failed = await call('payment', 'createPayment', { reservationId, method: 'CARD', simulateFailure: true }, token);
  assert.equal(failed.payment.status, 'FAILED');
  assert.equal((await call('booking', 'getReservation', { reservationId }, token)).reservation.status, 'PENDING');

  const paid = await call('payment', 'createPayment', { reservationId, method: 'CARD' }, token);
  assert.equal(paid.payment.status, 'PAID');
  assert.equal(paid.payment.amount, 620);
  assert.equal((await call('booking', 'getReservation', { reservationId }, token)).reservation.status, 'CONFIRMED');

  await expectFault(call('payment', 'createPayment', { reservationId, method: 'CARD' }, token), 'ALREADY_PAID');
  const byRes = await call('payment', 'getPaymentByReservation', { reservationId }, token);
  assert.equal(byRes.payment.id, paid.payment.id);
});

test('droits : un utilisateur ne voit que ses données, les routes admin sont protégées', async () => {
  await expectFault(call('user', 'listUsers', {}, token), 'FORBIDDEN');
  await expectFault(call('booking', 'getAllReservations', {}, token), 'FORBIDDEN');
  await expectFault(call('availability', 'createService', { name: 'X', type: 'HOTEL', location: 'Y', price: 10 }, token), 'FORBIDDEN');

  const other = await call('user', 'loginUser', { email: 'user@booking.tn', password: 'User1234!' });
  await expectFault(call('booking', 'getReservation', { reservationId }, other.token), 'FORBIDDEN');

  const all = await call('booking', 'getAllReservations', { status: 'CONFIRMED' }, adminToken);
  assert.ok(all.reservation.some((r) => r.id === reservationId));
  const mine = await call('booking', 'getUserReservations', {}, token);
  assert.equal(mine.reservation.length, 1);
  assert.equal(mine.reservation[0].serviceName, 'Vol Tunis - Paris');
});

test('règles 4 et 5 : annulation => places restituées et paiement remboursé', async () => {
  const { reservation } = await call('booking', 'cancelReservation', { reservationId }, token);
  assert.equal(reservation.status, 'CANCELLED');
  const after = await call('availability', 'checkAvailability', { serviceId: availability.serviceId, date: availability.date });
  assert.equal(after.availableSlots, availability.availableSlots);
  const pay = await call('payment', 'getPaymentByReservation', { reservationId }, token);
  assert.equal(pay.payment.status, 'REFUNDED');
  await expectFault(call('booking', 'cancelReservation', { reservationId }, token), 'ALREADY_CANCELLED');
  await expectFault(call('payment', 'createPayment', { reservationId, method: 'CARD' }, token), 'RESERVATION_CANCELLED');
});

test('remboursement administrateur', async () => {
  const { reservation } = await call('booking', 'createReservation', { availabilityId: availability.id, quantity: 1 }, token);
  const { payment } = await call('payment', 'createPayment', { reservationId: reservation.id, method: 'PAYPAL' }, token);
  await expectFault(call('payment', 'refundPayment', { paymentId: payment.id }, token), 'FORBIDDEN');
  const refunded = await call('payment', 'refundPayment', { paymentId: payment.id }, adminToken);
  assert.equal(refunded.payment.status, 'REFUNDED');
  assert.equal((await call('booking', 'getReservation', { reservationId: reservation.id }, token)).reservation.status, 'CANCELLED');
  await expectFault(call('payment', 'refundPayment', { paymentId: payment.id }, adminToken), 'NOT_REFUNDABLE');
});

test('concurrence : 15 réservations simultanées pour 5 places => jamais de survente', async () => {
  const { service } = await call('availability', 'createService',
    { name: 'Test Concurrence', type: 'EVENT', location: 'Tunis', price: 10 }, adminToken);
  const { availability: av } = await call('availability', 'setAvailability',
    { serviceId: service.id, date: '2030-07-01', totalSlots: 5 }, adminToken);

  const results = await Promise.allSettled(
    Array.from({ length: 15 }, () => call('booking', 'createReservation', { availabilityId: av.id, quantity: 1 }, token)));
  const ok = results.filter((r) => r.status === 'fulfilled');
  assert.equal(ok.length, 5);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 10);

  const check = await call('availability', 'checkAvailability', { serviceId: service.id, date: '2030-07-01' });
  assert.equal(check.availableSlots, 0);
  for (const r of ok) await call('booking', 'cancelReservation', { reservationId: r.value.reservation.id }, token);
});

test('administration : services et disponibilités', async () => {
  const { service } = await call('availability', 'createService',
    { name: 'Test Hotel', type: 'HOTEL', location: 'Djerba', price: 99.5, description: 'Hôtel de test' }, adminToken);
  assert.equal(service.price, 99.5);
  const { availability: av } = await call('availability', 'setAvailability', { serviceId: service.id, date: '2030-06-01', totalSlots: 10 }, adminToken);
  assert.equal(av.availableSlots, 10);
  const updated = await call('availability', 'updateService', { serviceId: service.id, price: 120 }, adminToken);
  assert.equal(updated.service.price, 120);

  // Un service ayant des réservations ne peut pas être supprimé
  const resv = await call('booking', 'createReservation', { availabilityId: av.id, quantity: 4 }, token);
  await expectFault(call('availability', 'setAvailability', { serviceId: service.id, date: '2030-06-01', totalSlots: 3 }, adminToken), 'BELOW_BOOKED');
  await expectFault(call('availability', 'deleteService', { serviceId: service.id }, adminToken), 'IN_USE');
  await call('booking', 'cancelReservation', { reservationId: resv.reservation.id }, token);

  // Un service sans réservation, lui, se supprime sans problème
  const temp = await call('availability', 'createService', { name: 'Test Temp', type: 'EVENT', location: 'Tunis', price: 5 }, adminToken);
  const del = await call('availability', 'deleteService', { serviceId: temp.service.id }, adminToken);
  assert.match(del.message, /supprimé/);
});

test('expiration : une réservation impayée est annulée, une payée est épargnée', async () => {
  const { expirePendingReservations } = require('../src/expiry');
  const slotsNow = async () => (await call('availability', 'checkAvailability',
    { serviceId: availability.serviceId, date: availability.date })).availableSlots;
  const start = await slotsNow();

  const unpaid = (await call('booking', 'createReservation', { availabilityId: availability.id, quantity: 2 }, token)).reservation;
  const paid = (await call('booking', 'createReservation', { availabilityId: availability.id, quantity: 1 }, token)).reservation;
  await call('payment', 'createPayment', { reservationId: paid.id, method: 'CARD' }, token);
  assert.equal(await slotsNow(), start - 3);

  // On « vieillit » les deux réservations de 30 minutes (délai d'expiration : 15 min)
  await pool.query('UPDATE reservations SET created_at = NOW() - INTERVAL 30 MINUTE WHERE id IN (?, ?)', [unpaid.id, paid.id]);
  assert.ok((await expirePendingReservations()) >= 1);

  assert.equal((await call('booking', 'getReservation', { reservationId: unpaid.id }, token)).reservation.status, 'CANCELLED');
  assert.equal((await call('booking', 'getReservation', { reservationId: paid.id }, token)).reservation.status, 'CONFIRMED');
  assert.equal(await slotsNow(), start - 1); // les 2 places de l'impayée sont revenues, celle de la payée reste prise
  await call('booking', 'cancelReservation', { reservationId: paid.id }, token); // nettoyage
});

test('profil : nom, photo, mot de passe (ancien exigé), liste sans photos', async () => {
  const photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
  const { user } = await call('user', 'updateUser', { name: 'Nouveau Nom', avatar: photo }, token);
  assert.equal(user.name, 'Nouveau Nom');
  assert.equal(user.avatar, photo);
  await expectFault(call('user', 'updateUser', { avatar: 'data:text/html;base64,AAAA' }, token), 'VALIDATION_ERROR');

  await expectFault(call('user', 'updateUser', { password: 'Autre12345' }, token), 'BAD_CREDENTIALS');
  await expectFault(call('user', 'updateUser', { currentPassword: 'faux', password: 'Autre12345' }, token), 'BAD_CREDENTIALS');
  await call('user', 'updateUser', { currentPassword: 'Secret123', password: 'Autre12345' }, token);
  assert.ok((await call('user', 'loginUser', { email, password: 'Autre12345' })).token);

  const users = await call('user', 'listUsers', {}, adminToken);
  assert.ok(users.user.every((u) => u.avatar === undefined));
  const removed = await call('user', 'updateUser', { removeAvatar: true }, token);
  assert.equal(removed.user.avatar, undefined);
});

test('dernier administrateur : ni rétrogradation ni suppression', async () => {
  const users = [].concat((await call('user', 'listUsers', {}, adminToken)).user);
  const admins = users.filter((u) => u.role === 'ADMIN');
  assert.equal(admins.length, 1, 'le jeu de démo ne doit avoir qu\'un administrateur');
  const id = admins[0].id;
  await expectFault(call('user', 'updateUser', { userId: id, role: 'USER' }, adminToken), 'LAST_ADMIN');
  // Mot de passe vérifié avant LAST_ADMIN : un mauvais mot de passe ne révèle pas l'autre code
  await expectFault(call('user', 'deleteUser', { userId: id, password: 'mauvais' }, adminToken), 'BAD_CREDENTIALS');
  await expectFault(call('user', 'deleteUser', { userId: id, password: 'Admin123!' }, adminToken), 'LAST_ADMIN');
  const still = await call('user', 'loginUser', { email: 'admin@booking.tn', password: 'Admin123!' });
  assert.ok(still.user);
  assert.equal(still.user.role, 'ADMIN');
  adminToken = still.token;
});

test('effacement du numéro de téléphone', async () => {
  const set = await call('user', 'updateUser', { phone: '22111111' }, token);
  assert.equal(set.user.phone, '22111111');
  // Une chaîne vide est absente : le numéro ne change pas sans removePhone
  const kept = await call('user', 'updateUser', { name: 'Test Utilisateur', phone: '' }, token);
  assert.equal(kept.user.phone, '22111111');
  const cleared = await call('user', 'updateUser', { removePhone: true }, token);
  assert.equal(cleared.user.phone, undefined);
});

test('téléphone : 8 chiffres commençant par 20-29, 50-59 ou 90-99', async () => {
  const stamp = Date.now();
  const valid = ['20123456', '29999999', '50123456', '59000000', '90123456', '99999999'];
  const invalid = ['12345678', '30123456', '49123456', '60123456', '89123456',
    '2012345', '201234567', '+21620123456', '20 123 456', '2012345a'];
  const expected = 'Numéro de téléphone invalide : il doit comporter 8 chiffres et commencer par 20 à 29, 50 à 59 ou 90 à 99.';

  for (const [i, phone] of valid.entries()) {
    const { user } = await call('user', 'registerUser',
      { name: 'Test Téléphone', email: `test.phone.ok.${i}.${stamp}@example.com`, password: 'Secret123', phone });
    assert.equal(user.phone, phone);
  }

  for (const [i, phone] of invalid.entries()) {
    await assert.rejects(
      call('user', 'registerUser',
        { name: 'Test Téléphone', email: `test.phone.ko.${i}.${stamp}@example.com`, password: 'Secret123', phone }),
      (err) => {
        const fault = err.root?.Envelope?.Body?.Fault;
        assert.equal(fault?.detail?.code, 'VALIDATION_ERROR');
        assert.equal(fault.faultstring, expected);
        return true;
      },
    );
  }

  // Champ facultatif : l'inscription sans numéro reste acceptée
  const { user } = await call('user', 'registerUser',
    { name: 'Test Sans Téléphone', email: `test.phone.vide.${stamp}@example.com`, password: 'Secret123' });
  assert.equal(user.phone, undefined);

  // La modification du profil applique la même règle
  await expectFault(call('user', 'updateUser', { phone: '+21620123456' }, token), 'VALIDATION_ERROR');
  await expectFault(call('user', 'updateUser', { phone: '2012345' }, token), 'VALIDATION_ERROR');
});

test('anti force brute : verrouillage après plusieurs échecs, succès remet à zéro', async () => {
  const { loginMaxAttempts } = require('../src/config');
  const lockEmail = `test.lock.${Date.now()}@example.com`;
  await call('user', 'registerUser', { name: 'Test Lock', email: lockEmail, password: 'Secret123' });
  for (let i = 0; i < loginMaxAttempts - 1; i++) {
    await expectFault(call('user', 'loginUser', { email: lockEmail, password: 'Mauvais1' }), 'BAD_CREDENTIALS');
  }
  assert.ok((await call('user', 'loginUser', { email: lockEmail, password: 'Secret123' })).token);
  for (let i = 0; i < loginMaxAttempts; i++) {
    await expectFault(call('user', 'loginUser', { email: lockEmail, password: 'Mauvais1' }), 'BAD_CREDENTIALS');
  }
  await assert.rejects(
    call('user', 'loginUser', { email: lockEmail, password: 'Secret123' }),
    (err) => {
      const fault = err.root?.Envelope?.Body?.Fault;
      assert.equal(fault?.detail?.code, 'TOO_MANY_ATTEMPTS');
      assert.match(fault.faultstring, /minute/);
      return true;
    },
  );
});

test('includeAll : dates passées et complètes', async () => {
  const { service } = await call('availability', 'createService',
    { name: 'Test Dates', type: 'EVENT', location: 'Tunis', price: 10 }, adminToken);
  await call('availability', 'setAvailability', { serviceId: service.id, date: '2020-01-15', totalSlots: 4 }, adminToken);
  const full = await call('availability', 'setAvailability', { serviceId: service.id, date: '2031-03-01', totalSlots: 2 }, adminToken);
  await call('availability', 'setAvailability', { serviceId: service.id, date: '2031-06-01', totalSlots: 3 }, adminToken);
  const booked = await call('booking', 'createReservation', { availabilityId: full.availability.id, quantity: 2 }, token);

  const open = [].concat((await call('availability', 'getAvailableSlots', { serviceId: service.id })).availability || []);
  assert.deepEqual(open.map((a) => a.date), ['2031-06-01']);

  const all = [].concat((await call('availability', 'getAvailableSlots', { serviceId: service.id, includeAll: true })).availability);
  assert.deepEqual(all.map((a) => a.date), ['2020-01-15', '2031-03-01', '2031-06-01']);
  assert.equal(all[1].availableSlots, 0);
  await call('booking', 'cancelReservation', { reservationId: booked.reservation.id }, token);
});

test('suppression de compte', async () => {
  // Il reste une réservation annulée seulement : la suppression est autorisée
  // Le mot de passe est exigé pour supprimer son propre compte
  await expectFault(call('user', 'deleteUser', {}, token), 'BAD_CREDENTIALS');
  await expectFault(call('user', 'deleteUser', { password: 'mauvais' }, token), 'BAD_CREDENTIALS');
  assert.ok((await call('user', 'getUser', {}, token)).user, 'le compte existe toujours après les refus');

  // Un admin supprime le compte d'un autre sans mot de passe
  const other = await call('user', 'registerUser', { name: 'Autre Test', email: `test.autre.${Date.now()}@example.com`, password: 'Secret123' });
  const byAdmin = await call('user', 'deleteUser', { userId: other.user.id }, adminToken);
  assert.match(byAdmin.message, /supprimé/);

  const res = await call('user', 'deleteUser', { password: 'Autre12345' }, token);
  assert.match(res.message, /supprimé/);
  await expectFault(call('booking', 'getUserReservations', {}, token), 'INVALID_TOKEN');
});
