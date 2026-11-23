const { pool, withTransaction } = require('../db');
const { fault } = require('../errors');
const V = require('../validators');
const { requireAdmin } = require('../auth');
const { toService, toAvailability } = require('../mappers');
const { SERVICE_SQL, SERVICE_JOIN } = require('../domain');
const { audit } = require('../audit');

/** Lit un service avec sa note moyenne (facultative). */
async function findService(id) {
  const [rows] = await pool.query(`${SERVICE_SQL} WHERE s.id = ?`, [id]);
  if (rows.length === 0) throw fault('NOT_FOUND', 'Service introuvable.');
  return rows[0];
}

// ---------- Consultation (publique) ----------

async function getAllServices(args) {
  const type = V.oneOf(args.type, 'type', V.SERVICE_TYPES, { required: false });
  const [rows] = type
    ? await pool.query(`${SERVICE_SQL} WHERE s.type = ? ORDER BY s.name`, [type])
    : await pool.query(`${SERVICE_SQL} ORDER BY s.type, s.name`);
  return { service: rows.map(toService) };
}

async function getServiceById(args) {
  const id = V.int(args.serviceId, 'serviceId');
  return { service: toService(await findService(id)) };
}

// Tris acceptés par searchServices (valeurs exactes, en minuscules).
const SORTS = {
  price_asc: 's.price ASC, s.name',
  price_desc: 's.price DESC, s.name',
  rating: 'rev.avg_rating IS NULL, rev.avg_rating DESC, s.name',
  name: 's.name',
};

async function searchServices(args) {
  const where = [];
  const params = [];
  const keyword = V.str(args.keyword, 'keyword', { max: 100, required: false });
  if (keyword) {
    where.push('(s.name LIKE ? OR s.description LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const type = V.oneOf(args.type, 'type', V.SERVICE_TYPES, { required: false });
  if (type) { where.push('s.type = ?'); params.push(type); }
  const location = V.str(args.location, 'location', { max: 150, required: false });
  if (location) { where.push('s.location LIKE ?'); params.push(`%${location}%`); }
  const maxPrice = V.money(args.maxPrice, 'maxPrice', { required: false });
  if (maxPrice !== undefined) { where.push('s.price <= ?'); params.push(maxPrice); }
  const date = V.date(args.date, 'date', { required: false });
  if (date) {
    where.push('EXISTS (SELECT 1 FROM availabilities a WHERE a.service_id = s.id AND a.date = ? AND a.available_slots > 0)');
    params.push(date);
  }

  // --- Recherche avancée (facultative, rétrocompatible) ---
  const sortRaw = V.str(args.sortBy, 'sortBy', { max: 20, required: false });
  if (sortRaw !== undefined && !SORTS[sortRaw]) {
    throw fault('VALIDATION_ERROR', `"sortBy" doit valoir : ${Object.keys(SORTS).join(', ')}.`);
  }
  const order = SORTS[sortRaw] || 's.type, s.name';

  const minRating = V.intRange(args.minRating, 'minRating', 0, 5, { required: false });
  if (minRating) { where.push('rev.avg_rating >= ?'); params.push(minRating); }

  const limit = V.intRange(args.limit, 'limit', 1, 100, { required: false });
  const offset = V.int(args.offset, 'offset', { min: 0, required: false }) ?? 0;

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // Le total est calculé sur la même sélection, avant pagination.
  const [count] = await pool.query(`SELECT COUNT(*) AS n FROM services s${SERVICE_JOIN} ${whereSql}`, params);
  const paged = limit !== undefined ? ' LIMIT ? OFFSET ?' : '';
  const [rows] = await pool.query(
    `${SERVICE_SQL} ${whereSql} ORDER BY ${order}${paged}`,
    limit !== undefined ? [...params, limit, offset] : params,
  );
  return { service: rows.map(toService), total: Number(count[0].n) };
}

async function checkAvailability(args) {
  const serviceId = V.int(args.serviceId, 'serviceId');
  const date = V.date(args.date);
  const quantity = V.int(args.quantity, 'quantity', { required: false }) ?? 1;
  await findService(serviceId);
  const [rows] = await pool.query('SELECT * FROM availabilities WHERE service_id = ? AND date = ?', [serviceId, date]);
  if (rows.length === 0) return { available: false, availableSlots: 0 };
  return {
    available: rows[0].available_slots >= quantity,
    availableSlots: rows[0].available_slots,
    availability: toAvailability(rows[0]),
  };
}

async function getAvailableSlots(args) {
  const serviceId = V.int(args.serviceId, 'serviceId');
  await findService(serviceId);
  // includeAll : l'admin voit aussi les dates passées et les dates sans place libre.
  const includeAll = V.bool(args.includeAll);
  const [rows] = await pool.query(
    includeAll
      ? 'SELECT * FROM availabilities WHERE service_id = ? ORDER BY date'
      : 'SELECT * FROM availabilities WHERE service_id = ? AND date >= CURDATE() AND available_slots > 0 ORDER BY date',
    [serviceId],
  );
  return { availability: rows.map(toAvailability) };
}

// ---------- Administration ----------

async function createService(args, headers) {
  const auth = await requireAdmin(headers);
  const data = [
    V.str(args.name, 'name', { max: 150 }),
    V.oneOf(args.type, 'type', V.SERVICE_TYPES),
    V.str(args.description, 'description', { max: 5000, required: false }) ?? null,
    V.str(args.location, 'location', { max: 150 }),
    V.imageUrl(args.imageUrl) ?? null,
    V.money(args.price, 'price'),
  ];
  const [result] = await pool.query(
    'INSERT INTO services (name, type, description, location, image_url, price) VALUES (?, ?, ?, ?, ?, ?)', data);
  await audit(pool, auth.id, 'CREATE_SERVICE', 'SERVICE', result.insertId, data[0]);
  return { service: toService(await findService(result.insertId)) };
}

async function updateService(args, headers) {
  const auth = await requireAdmin(headers);
  const id = V.int(args.serviceId, 'serviceId');
  const before = await findService(id);
  const fields = {
    name: V.str(args.name, 'name', { max: 150, required: false }),
    type: V.oneOf(args.type, 'type', V.SERVICE_TYPES, { required: false }),
    description: V.str(args.description, 'description', { max: 5000, required: false }),
    location: V.str(args.location, 'location', { max: 150, required: false }),
    image_url: V.imageUrl(args.imageUrl),
    price: V.money(args.price, 'price', { required: false }),
  };
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) throw fault('VALIDATION_ERROR', 'Aucune donnée à modifier.');
  await pool.query(
    `UPDATE services SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`,
    [...entries.map(([, v]) => v), id],
  );
  await audit(pool, auth.id, 'UPDATE_SERVICE', 'SERVICE', id, `« ${before.name} » : ${entries.map(([k]) => k).join(', ')}`);
  return { service: toService(await findService(id)) };
}

async function deleteService(args, headers) {
  const auth = await requireAdmin(headers);
  const id = V.int(args.serviceId, 'serviceId');
  const service = await findService(id);
  await pool.query('DELETE FROM services WHERE id = ?', [id]); // refusé par la FK s'il existe des réservations
  await audit(pool, auth.id, 'DELETE_SERVICE', 'SERVICE', id, service.name);
  return { message: 'Service supprimé.' };
}

/** Crée ou met à jour le stock d'un créneau, sans jamais descendre sous le nombre de places déjà réservées. */
async function setAvailability(args, headers) {
  const auth = await requireAdmin(headers);
  const serviceId = V.int(args.serviceId, 'serviceId');
  const date = V.date(args.date);
  const total = V.int(args.totalSlots, 'totalSlots', { min: 0 });
  await findService(serviceId);

  const result = await withTransaction(async (conn) => {
    const [rows] = await conn.query(
      'SELECT * FROM availabilities WHERE service_id = ? AND date = ? FOR UPDATE', [serviceId, date]);
    let id;
    if (rows.length === 0) {
      const [r] = await conn.query(
        'INSERT INTO availabilities (service_id, date, total_slots, available_slots) VALUES (?, ?, ?, ?)',
        [serviceId, date, total, total]);
      id = r.insertId;
    } else {
      const booked = rows[0].total_slots - rows[0].available_slots;
      if (total < booked) throw fault('BELOW_BOOKED', `Impossible : ${booked} places sont déjà réservées.`);
      await conn.query('UPDATE availabilities SET total_slots = ?, available_slots = ? WHERE id = ?',
        [total, total - booked, rows[0].id]);
      id = rows[0].id;
    }
    const [fresh] = await conn.query('SELECT * FROM availabilities WHERE id = ?', [id]);
    return { availability: toAvailability(fresh[0]) };
  });
  await audit(pool, auth.id, 'SET_AVAILABILITY', 'AVAILABILITY', serviceId, `${date} : ${total} place(s)`);
  return result;
}

module.exports = {
  getAllServices, getServiceById, searchServices, checkAvailability, getAvailableSlots,
  createService, updateService, deleteService, setAvailability,
};
