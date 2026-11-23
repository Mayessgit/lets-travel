// Génère les enveloppes SOAP de docs/requests/ et la collection Postman/Thunder Client.
// Une seule source de vérité (OPERATIONS) : les XML et le JSON restent ainsi synchronisés.
// Aucune dépendance npm : lancer `npm run generate-collection` depuis backend/.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const REQUESTS_DIR = path.join(ROOT, 'docs', 'requests');
const COLLECTION_FILE = path.join(ROOT, 'docs', 'booking-soap.postman_collection.json');
const NS = 'http://booking.example.com/soap';
const BASE_URL = 'http://localhost:4000';

/** Date relative à aujourd'hui au format AAAA-MM-JJ (les créneaux de démo sont relatifs à CURDATE()). */
const isoPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

// Chaque opération : nom, niveau d'accès et arguments d'exemple cohérents avec schema.sql.
// Les identifiants 1 à 3 correspondent aux données de démonstration (services, créneaux, admin).
const SERVICES = [
  {
    service: 'user',
    label: 'UserService',
    operations: [
      { name: 'registerUser', access: 'public', args: { name: 'Nouveau Client', email: 'nouveau.client@example.com', password: 'Secret123', phone: '55123456' } },
      { name: 'loginUser', access: 'public', args: { email: 'admin@booking.tn', password: 'Admin123!' } },
      { name: 'getUser', access: 'auth', args: { userId: 2 } },
      { name: 'updateUser', access: 'auth', args: { userId: 2, name: 'Utilisateur Test', phone: '20000000' } },
      { name: 'deleteUser', access: 'auth', args: { userId: 999 } },
      { name: 'listUsers', access: 'auth', args: {} },
    ],
  },
  {
    service: 'availability',
    label: 'AvailabilityService',
    operations: [
      { name: 'getAllServices', access: 'public', args: {} },
      { name: 'getServiceById', access: 'public', args: { serviceId: 1 } },
      { name: 'searchServices', access: 'public', args: { keyword: 'Hôtel', type: 'HOTEL', maxPrice: 200, sortBy: 'price_asc', limit: 12, offset: 0 } },
      // Créneau de démo de l'Hôtel Tunis Palace : aujourd'hui + 11 jours, 30 places dont 12 libres.
      { name: 'checkAvailability', access: 'public', args: { serviceId: 1, date: isoPlus(11), quantity: 2 } },
      { name: 'getAvailableSlots', access: 'public', args: { serviceId: 1, includeAll: true } },
      { name: 'createService', access: 'auth', args: { name: 'Test Excursion Tozeur', type: 'EVENT', location: 'Tozeur', price: 75, description: 'Excursion de démonstration.' } },
      { name: 'updateService', access: 'auth', args: { serviceId: 1, price: 180 } },
      { name: 'deleteService', access: 'auth', args: { serviceId: 999 } },
      { name: 'setAvailability', access: 'auth', args: { serviceId: 1, date: isoPlus(40), totalSlots: 25 } },
    ],
  },
  {
    service: 'booking',
    label: 'BookingService',
    operations: [
      // availabilityId 3 = Hôtel Sousse Beach (aujourd'hui + 7 jours, 40 places libres).
      { name: 'createReservation', access: 'auth', args: { availabilityId: 3, quantity: 2, promoCode: 'WELCOME10' } },
      { name: 'getReservation', access: 'auth', args: { reservationId: 1 } },
      { name: 'getUserReservations', access: 'auth', args: {} },
      { name: 'cancelReservation', access: 'auth', args: { reservationId: 1 } },
      { name: 'updateReservation', access: 'auth', args: { reservationId: 1, quantity: 2 } },
      { name: 'getAllReservations', access: 'auth', args: { status: 'CONFIRMED' } },
    ],
  },
  {
    service: 'payment',
    label: 'PaymentService',
    operations: [
      { name: 'createPayment', access: 'auth', args: { reservationId: 1, method: 'CARD' } },
      { name: 'getPayment', access: 'auth', args: { paymentId: 1 } },
      { name: 'getPaymentByReservation', access: 'auth', args: { reservationId: 1 } },
      { name: 'refundPayment', access: 'auth', args: { paymentId: 1 } },
      { name: 'getAllPayments', access: 'auth', args: { status: 'PAID' } },
      { name: 'getMyPayments', access: 'auth', args: {} },
    ],
  },
  {
    service: 'engagement',
    label: 'EngagementService',
    operations: [
      { name: 'addFavorite', access: 'auth', args: { serviceId: 1 } },
      { name: 'removeFavorite', access: 'auth', args: { serviceId: 1 } },
      { name: 'getFavorites', access: 'auth', args: {} },
      { name: 'saveReview', access: 'auth', args: { serviceId: 1, rating: 5, comment: 'Très bon séjour.' } },
      { name: 'deleteReview', access: 'auth', args: { reviewId: 1 } },
      { name: 'getServiceReviews', access: 'public', args: { serviceId: 1, limit: 10, offset: 0 } },
      { name: 'getMyNotifications', access: 'auth', args: { limit: 10 } },
      { name: 'markNotificationRead', access: 'auth', args: { notificationId: 1 } },
      { name: 'markAllNotificationsRead', access: 'auth', args: {} },
      { name: 'checkPromoCode', access: 'auth', args: { code: 'WELCOME10' } },
    ],
  },
  {
    service: 'admin',
    label: 'AdminService',
    operations: [
      { name: 'getDashboardStats', access: 'auth', args: { days: 30 } },
      { name: 'getAuditLog', access: 'auth', args: { limit: 50, offset: 0 } },
      { name: 'getAllReviews', access: 'auth', args: { limit: 50, offset: 0 } },
      { name: 'createPromoCode', access: 'auth', args: { code: 'TESTPROMO', percent: 15, validFrom: isoPlus(0), validTo: isoPlus(30), maxUses: 50 } },
      { name: 'listPromoCodes', access: 'auth', args: {} },
      { name: 'setPromoCodeActive', access: 'auth', args: { promoCodeId: 1, active: true } },
      { name: 'deletePromoCode', access: 'auth', args: { promoCodeId: 999 } },
    ],
  },
];

const ACCESS_LABEL = {
  public: 'Public (sans token)',
  auth: 'Authentifié (en-tête AuthToken requis ; ADMIN pour les opérations d’administration)',
};

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const toXmlArgs = (args) => Object.entries(args)
  .map(([k, v]) => `<tns:${k}>${esc(v)}</tns:${k}>`)
  .join('');

/** Enveloppe SOAP complète ; le token est la variable {{token}} de la collection. */
function buildEnvelope(op, args) {
  const header = op.access === 'auth'
    ? '<soapenv:Header><tns:AuthToken>{{token}}</tns:AuthToken></soapenv:Header>'
    : '';
  return '<?xml version="1.0" encoding="utf-8"?>\n'
    + `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="${NS}">`
    + `${header}<soapenv:Body>`
    + `<tns:${op.name}>${toXmlArgs(args)}</tns:${op.name}>`
    + '</soapenv:Body></soapenv:Envelope>\n';
}

/** Un dossier Postman v2.1 par service, une requête par opération. */
function postmanItem(service, op, xml) {
  return {
    name: op.name,
    request: {
      method: 'POST',
      description: `Accès : ${ACCESS_LABEL[op.access] || op.access}`,
      header: [{ key: 'Content-Type', value: 'text/xml; charset=utf-8', type: 'text' }],
      body: { mode: 'raw', raw: xml, options: { raw: { language: 'xml' } } },
      url: {
        raw: `{{baseUrl}}/soap/${service}`,
        host: ['{{baseUrl}}'],
        path: ['soap', service],
      },
    },
    response: [],
  };
}

function main() {
  const folders = [];
  let count = 0;

  for (const group of SERVICES) {
    const dir = path.join(REQUESTS_DIR, group.service);
    fs.mkdirSync(dir, { recursive: true });
    const items = [];

    for (const op of group.operations) {
      const xml = buildEnvelope(op, op.args);
      fs.writeFileSync(path.join(dir, `${op.name}.xml`), xml, 'utf8');
      items.push(postmanItem(group.service, op, xml));
      count += 1;
    }
    folders.push({ name: group.label, item: items });
  }

  const collection = {
    info: {
      name: 'Plateforme de réservation — SOAP',
      description: 'Collection générée par backend/scripts/generate-collection.js. '
        + 'Importer dans Thunder Client (Collections → Import) ou Postman, appeler loginUser, '
        + 'puis copier le token renvoyé dans la variable {{token}}. '
        + 'Le corps est du XML brut : mode XML/Text, jamais JSON.',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: [
      { key: 'baseUrl', value: BASE_URL, type: 'string' },
      { key: 'token', value: '', type: 'string' },
    ],
    item: folders,
  };

  fs.writeFileSync(COLLECTION_FILE, `${JSON.stringify(collection, null, 2)}\n`, 'utf8');
  console.log(`${count} enveloppes SOAP écrites dans docs/requests/`);
  console.log(`Collection écrite dans ${path.relative(ROOT, COLLECTION_FILE)}`);
}

main();
