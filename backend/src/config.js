require('dotenv').config({ quiet: true });

/** Entier strictement positif, sinon la valeur par défaut (évite NaN si la variable est vide). */
function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

const config = {
  port: Number(process.env.PORT) || 4000,
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`,
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'booking_soap_db',
  },
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-a-changer',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '2h',
  reservationTtlMinutes: Number(process.env.RESERVATION_TTL_MINUTES) || 15,
  // Fenêtre anti force brute de loginUser (compteur en mémoire, par email).
  loginMaxAttempts: positiveInt(process.env.LOGIN_MAX_ATTEMPTS, 5),
  loginLockMinutes: positiveInt(process.env.LOGIN_LOCK_MINUTES, 15),
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:5173')
    .split(',').map((s) => s.trim()).filter(Boolean),
};

if (!process.env.JWT_SECRET) {
  console.warn('[config] JWT_SECRET absent : secret de développement utilisé. À définir dans .env.');
}

module.exports = config;
