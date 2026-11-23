import { useEffect, useRef, useState } from 'react';
import { list } from './soap';

const dateFmt = (value) => {
  const d = new Date(String(value || '').replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
};

/** Cloche de l'en-tête : nombre de non-lues, liste déroulante, lecture individuelle ou globale. */
export default function Notifications({ api, notify }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ items: [], unread: 0 });
  const box = useRef(null);

  const load = async () => {
    try {
      const r = await api('engagement', 'getMyNotifications', { limit: 10 });
      setData({ items: list(r?.notification), unread: Number(r?.unreadCount || 0) });
    } catch {
      // Silencieux : la cloche ne doit pas afficher de toast à chaque échec réseau.
    }
  };

  // Rafraîchissement périodique ; le timer est libéré à la déconnexion (démontage).
  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);

  // Fermeture au clic en dehors du menu.
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const openMenu = () => {
    setOpen(!open);
    if (!open) load();
  };

  const markRead = async (n) => {
    if (String(n.isRead) === 'true') return;
    try {
      await api('engagement', 'markNotificationRead', { notificationId: n.id });
      setData((prev) => ({
        items: prev.items.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)),
        unread: Math.max(0, prev.unread - 1),
      }));
    } catch (e) { notify(e.message, true); }
  };

  const markAll = async () => {
    try {
      await api('engagement', 'markAllNotificationsRead', {});
      setData((prev) => ({ items: prev.items.map((x) => ({ ...x, isRead: true })), unread: 0 }));
    } catch (e) { notify(e.message, true); }
  };

  return (
    <div className="notif" ref={box}>
      <button className="icon-btn" onClick={openMenu} aria-label={`Notifications${data.unread ? ` (${data.unread} non lues)` : ''}`} aria-expanded={open}>
        🔔
        {data.unread > 0 && <span className="badge">{data.unread > 9 ? '9+' : data.unread}</span>}
      </button>

      {open && (
        <div className="notif-menu">
          <div className="row-between">
            <strong>Notifications</strong>
            {data.unread > 0 && <button className="link" onClick={markAll}>Tout marquer comme lu</button>}
          </div>
          {data.items.length === 0 ? (
            <p className="muted">Aucune notification pour le moment.</p>
          ) : (
            <ul>
              {data.items.map((n) => (
                <li key={n.id} className={String(n.isRead) === 'true' ? '' : 'unread'}>
                  <button className="notif-item" onClick={() => markRead(n)}>
                    <b>{n.title}</b>
                    <span>{n.message}</span>
                    <small className="muted">{dateFmt(n.createdAt)}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
