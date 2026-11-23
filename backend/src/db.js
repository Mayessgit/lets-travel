const mysql = require('mysql2/promise');
const { db } = require('./config');

// dateStrings : DATE/TIMESTAMP renvoyés en texte (AAAA-MM-JJ), pas en objets Date
const pool = mysql.createPool({
  ...db,
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
});

/** Exécute fn(conn) dans une transaction (commit si OK, rollback si erreur). */
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, withTransaction };
