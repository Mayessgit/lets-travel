// Notifications « dans l'application ».
// Toujours appelées avec la connexion de la transaction en cours : une notification
// n'existe que si l'action qui la déclenche est validée (pas de fantôme après rollback).
const MAX_MESSAGE = 500;

async function notify(conn, userId, type, title, message) {
  await conn.query(
    'INSERT INTO notifications (user_id, type, title, message) VALUES (?, ?, ?, ?)',
    [userId, type, String(title).slice(0, 150), String(message).slice(0, MAX_MESSAGE)],
  );
}

module.exports = { notify };
