// Journal d'audit des actions d'administration.
// On accepte aussi bien le pool que la connexion d'une transaction en cours.
const MAX_DETAILS = 500;

async function audit(conn, adminId, action, entity, entityId = null, details = null) {
  await conn.query(
    'INSERT INTO audit_logs (admin_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)',
    [adminId ?? null, action, entity, entityId ?? null, details === null ? null : String(details).slice(0, MAX_DETAILS)],
  );
}

module.exports = { audit };
