const { pool } = require('../src/db');

(async () => {
  const [before] = await pool.query("SELECT id, email, role FROM users WHERE email = 'admin@booking.tn' OR role = 'ADMIN'");
  console.log('before', before);
  const [r] = await pool.query("UPDATE users SET role = 'ADMIN' WHERE email = 'admin@booking.tn'");
  console.log('restored', r.affectedRows);
  const [hotels] = await pool.query("SELECT id, name, type, price FROM services WHERE type = 'HOTEL' ORDER BY name");
  console.log('hotels', hotels);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
