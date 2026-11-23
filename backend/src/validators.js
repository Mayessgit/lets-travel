const { fault } = require('./errors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Téléphone tunisien : 8 chiffres, préfixe 20–29, 50–59 ou 90–99 (ni +216, ni espaces, ni tirets).
const PHONE_RE = /^(2|5|9)\d{7}$/;
const PHONE_ERROR = 'Numéro de téléphone invalide : il doit comporter 8 chiffres et commencer par 20 à 29, 50 à 59 ou 90 à 99.';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SERVICE_TYPES = ['HOTEL', 'FLIGHT', 'EVENT'];
const RESERVATION_STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED'];
const PAYMENT_STATUSES = ['PENDING', 'PAID', 'FAILED', 'REFUNDED'];
const PAYMENT_METHODS = ['CARD', 'PAYPAL', 'BANK_TRANSFER'];
const ROLES = ['USER', 'ADMIN'];

const invalid = (msg) => fault('VALIDATION_ERROR', msg);

/** Les éléments XML vides arrivent comme '' : on les traite comme absents. */
const opt = (v) => (v === undefined || v === null || v === '' ? undefined : v);

function str(v, field, { min = 1, max = 255, required = true } = {}) {
  v = opt(v);
  if (v === undefined) {
    if (required) throw invalid(`Le champ "${field}" est obligatoire.`);
    return undefined;
  }
  v = String(v).trim();
  if (v.length < min || v.length > max) throw invalid(`Le champ "${field}" doit contenir entre ${min} et ${max} caractères.`);
  return v;
}

function int(v, field, { min = 1, required = true } = {}) {
  v = opt(v);
  if (v === undefined) {
    if (required) throw invalid(`Le champ "${field}" est obligatoire.`);
    return undefined;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw invalid(`Le champ "${field}" doit être un entier >= ${min}.`);
  return n;
}

function money(v, field, { required = true } = {}) {
  v = opt(v);
  if (v === undefined) {
    if (required) throw invalid(`Le champ "${field}" est obligatoire.`);
    return undefined;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw invalid(`Le champ "${field}" doit être un nombre positif.`);
  return Math.round(n * 100) / 100;
}

function oneOf(v, field, allowed, { required = true } = {}) {
  v = opt(v);
  if (v === undefined) {
    if (required) throw invalid(`Le champ "${field}" est obligatoire.`);
    return undefined;
  }
  v = String(v).trim().toUpperCase();
  if (!allowed.includes(v)) throw invalid(`"${field}" doit valoir : ${allowed.join(', ')}.`);
  return v;
}

function email(v) {
  const e = str(v, 'email', { max: 150 }).toLowerCase();
  if (!EMAIL_RE.test(e)) throw invalid('Adresse email invalide.');
  return e;
}

function password(v) {
  v = opt(v);
  if (v === undefined) throw invalid('Le mot de passe est obligatoire.');
  v = String(v);
  if (v.length < 8 || v.length > 72 || !/[A-Za-z]/.test(v) || !/\d/.test(v)) {
    throw invalid('Le mot de passe doit contenir 8 à 72 caractères, dont au moins une lettre et un chiffre.');
  }
  return v;
}

function phone(v) {
  v = opt(v);
  if (v === undefined) return undefined; // facultatif : un champ vide reste accepté
  v = String(v).trim();
  if (!PHONE_RE.test(v)) throw invalid(PHONE_ERROR);
  return v;
}

/** Booléen tolérant : node-soap envoie true / 'true' / '1' selon le client. */
function bool(v) {
  return v === true || v === 'true' || v === '1' || v === 1;
}

/** Entier borné (notes de 1 à 5, pourcentages de 1 à 100…). */
function intRange(v, field, min, max, opts = {}) {
  const n = int(v, field, { ...opts, min });
  if (n === undefined) return undefined;
  if (n > max) throw invalid(`Le champ "${field}" doit être un entier entre ${min} et ${max}.`);
  return n;
}

/** Code promo : 3 à 30 caractères, normalisé en majuscules. */
function promoCode(v) {
  v = opt(v);
  if (v === undefined) return undefined;
  const c = String(v).trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,30}$/.test(c)) throw invalid('Code promo invalide : 3 à 30 caractères (lettres, chiffres, - et _).');
  return c;
}

function date(v, field = 'date', { required = true } = {}) {
  v = str(v, field, { required });
  if (v === undefined) return undefined;
  if (!DATE_RE.test(v) || Number.isNaN(Date.parse(v))) throw invalid(`"${field}" doit être au format AAAA-MM-JJ.`);
  return v;
}

/** Photo de profil : data URL image (JPEG/PNG/WebP) de 150 000 caractères maximum (~110 Ko). */
function avatar(v) {
  v = opt(v);
  if (v === undefined) return undefined;
  v = String(v);
  if (v.length > 150000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) {
    throw invalid('Photo invalide : JPEG, PNG ou WebP, 110 Ko maximum.');
  }
  return v;
}

/** Image : chemin local (/images/x.jpg) ou URL http(s). */
function imageUrl(v) {
  v = str(v, 'imageUrl', { max: 500, required: false });
  if (v !== undefined && !/^(\/|https?:\/\/)/.test(v)) throw invalid('"imageUrl" doit commencer par "/" ou "http(s)://".');
  return v;
}

module.exports = {
  opt, str, int, money, oneOf, email, password, phone, date, imageUrl, avatar,
  bool, intRange, promoCode,
  SERVICE_TYPES, RESERVATION_STATUSES, PAYMENT_STATUSES, PAYMENT_METHODS, ROLES,
};
