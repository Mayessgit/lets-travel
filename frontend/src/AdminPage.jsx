import { useEffect, useState } from 'react';
import { list } from './soap';
import DataTable from './DataTable.jsx';
import Dashboard from './Dashboard.jsx';
import { Stars } from './ServiceCard.jsx';

const money = (n) => `${Number(n).toFixed(2)} TND`;
const STATUS_LABEL = { PENDING: 'En attente', CONFIRMED: 'Confirmée', CANCELLED: 'Annulée' };
const PAY_LABEL = { PAID: 'Payé', FAILED: 'Refusé', REFUNDED: 'Remboursé', PENDING: 'En attente' };
const METHODS = { CARD: 'Carte bancaire', PAYPAL: 'PayPal', BANK_TRANSFER: 'Virement' };
const TABS = [
  ['dashboard', 'Tableau de bord'],
  ['services', 'Services'],
  ['reservations', 'Réservations'],
  ['payments', 'Paiements'],
  ['users', 'Utilisateurs'],
  ['reviews', 'Avis'],
  ['promos', 'Codes promo'],
  ['audit', 'Journal'],
];

export default function AdminPage({ api, notify, session }) {
  const [tab, setTab] = useState('dashboard');
  const [focusService, setFocusService] = useState(null);
  const p = { api, notify, me: session.user };

  return (
    <>
      <h1>Administration</h1>
      <div className="tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key}
            className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {tab === 'dashboard' && (
        <Dashboard api={api} notify={notify} onOpenService={(id) => { setFocusService(id); setTab('services'); }} />
      )}
      {tab === 'services' && <ServicesAdmin {...p} focusServiceId={focusService} onFocusHandled={() => setFocusService(null)} />}
      {tab === 'reservations' && <ReservationsAdmin {...p} />}
      {tab === 'payments' && <PaymentsAdmin {...p} />}
      {tab === 'users' && <UsersAdmin {...p} />}
      {tab === 'reviews' && <ReviewsAdmin {...p} />}
      {tab === 'promos' && <PromosAdmin {...p} />}
      {tab === 'audit' && <AuditAdmin {...p} />}
    </>
  );
}

/** Charge une liste SOAP ; renvoie [lignes, recharger]. */
function useList(api, notify, service, op, key, args = {}) {
  const [rows, setRows] = useState(null);
  const reload = async () => {
    try {
      // Une réponse sans élément enfant est renvoyée null par le parseur XML.
      const result = await api(service, op, args);
      setRows(list(result?.[key]));
    } catch (e) { notify(e.message, true); setRows([]); }
  };
  useEffect(() => { reload(); }, [JSON.stringify(args)]);
  return [rows, reload];
}

/** Exécute une action, affiche le résultat, puis recharge la liste. */
const makeAct = (notify, reload) => async (fn, ok) => {
  try { await fn(); notify(ok); } catch (e) { notify(e.message, true); }
  reload();
};

/* ---------------- Services + disponibilités ---------------- */

const EMPTY = { name: '', type: 'HOTEL', location: '', price: '', description: '', imageUrl: '' };

function ServicesAdmin({ api, notify, focusServiceId, onFocusHandled }) {
  const [services, reload] = useList(api, notify, 'availability', 'getAllServices', 'service');
  const [form, setForm] = useState(null);
  const [dates, setDates] = useState(null);
  const act = makeAct(notify, reload);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // Depuis le tableau de bord : ouvrir directement les dates du service signalé.
  useEffect(() => {
    if (!focusServiceId || !services) return;
    const target = services.find((s) => Number(s.id) === Number(focusServiceId));
    if (target) { setDates(target); onFocusHandled?.(); }
  }, [focusServiceId, services]);

  const save = (e) => {
    e.preventDefault();
    const { id, name, type, location, price, description, imageUrl } = form;
    const data = { name, type, location, price, description, imageUrl };
    act(async () => {
      await (id ? api('availability', 'updateService', { serviceId: id, ...data }) : api('availability', 'createService', data));
      setForm(null);
    }, id ? 'Service modifié.' : 'Service créé.');
  };
  const remove = (s) => window.confirm(`Supprimer « ${s.name} » ?`) &&
    act(() => api('availability', 'deleteService', { serviceId: s.id }), 'Service supprimé.');

  return (
    <>
      <div className="toolbar"><button className="primary" onClick={() => setForm(EMPTY)}>+ Nouveau service</button></div>

      {form && (
        <form className="card formgrid" onSubmit={save}>
          <input placeholder="Nom" value={form.name} onChange={set('name')} required />
          <select value={form.type} onChange={set('type')}>
            <option value="HOTEL">Hôtel</option><option value="FLIGHT">Vol</option><option value="EVENT">Événement</option>
          </select>
          <input placeholder="Lieu" value={form.location} onChange={set('location')} required />
          <input type="number" min="0" step="0.01" placeholder="Prix" value={form.price} onChange={set('price')} required />
          <input className="wide" placeholder="Image : /images/mon-hotel.jpg ou https://..." value={form.imageUrl || ''} onChange={set('imageUrl')} />
          <input className="wide" placeholder="Description" value={form.description || ''} onChange={set('description')} />
          <div className="wide actions">
            <button className="primary">{form.id ? 'Enregistrer' : 'Créer'}</button>
            <button type="button" onClick={() => setForm(null)}>Annuler</button>
          </div>
        </form>
      )}

      <div className="table">
        {services == null ? <p className="muted">Chargement…</p> : services.length === 0 ? <p className="muted">Aucun service.</p> : (
          <table>
            <thead><tr><th>#</th><th>Nom</th><th>Type</th><th>Lieu</th><th>Prix</th><th>Note</th><th>Actions</th></tr></thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.id}>
                  <td>{s.id}</td><td>{s.name}</td><td>{s.type}</td><td>{s.location}</td><td>{money(s.price)}</td>
                  <td>{s.reviewCount ? <Stars value={s.averageRating} count={s.reviewCount} /> : '—'}</td>
                  <td className="actions">
                    <button onClick={() => setDates(s)}>Dates</button>
                    <button onClick={() => setForm({ ...s, id: s.id })}>Modifier</button>
                    <button className="danger" onClick={() => remove(s)}>Supprimer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {dates && <DatesPanel key={dates.id} service={dates} api={api} notify={notify} onClose={() => setDates(null)} />}
    </>
  );
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function DatesPanel({ service, api, notify, onClose }) {
  const [slots, reload] = useList(api, notify, 'availability', 'getAvailableSlots', 'availability', { serviceId: service.id, includeAll: true });
  const [f, setF] = useState({ date: '', totalSlots: '' });
  const act = makeAct(notify, reload);
  const today = todayIso();

  const submit = (e) => {
    e.preventDefault();
    act(() => api('availability', 'setAvailability', { serviceId: service.id, ...f }), 'Disponibilité enregistrée.');
  };

  return (
    <div className="card panel">
      <div className="row-between"><h3>Dates de « {service.name} »</h3><button onClick={onClose}>Fermer</button></div>
      <form className="filters" onSubmit={submit}>
        <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required aria-label="Date" />
        <input type="number" min="0" placeholder="Nombre total de places" value={f.totalSlots}
          onChange={(e) => setF({ ...f, totalSlots: e.target.value })} required aria-label="Nombre total de places" />
        <button className="primary">Ajouter / modifier</button>
      </form>
      <p className="muted">Toutes les dates sont affichées, y compris les dates passées et celles sans place libre. Une date existante est mise à jour (le total ne peut pas descendre sous les places déjà réservées).</p>
      <div className="table">
        {slots == null ? <p className="muted">Chargement…</p> : slots.length === 0 ? <p className="muted">Aucune date pour ce service.</p> : (
          <table>
            <thead><tr><th>Date</th><th>Places disponibles</th><th>Total</th><th /></tr></thead>
            <tbody>
              {slots.map((a) => (
                <tr key={a.id}>
                  <td>{a.date}</td><td>{a.availableSlots}</td><td>{a.totalSlots}</td>
                  <td>
                    {a.date < today && <span className="status CANCELLED">Passée</span>}
                    {a.date >= today && Number(a.availableSlots) === 0 && <span className="status">Complet</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ---------------- Réservations ---------------- */

function ReservationsAdmin({ api, notify }) {
  const [rows, reload] = useList(api, notify, 'booking', 'getAllReservations', 'reservation');
  const act = makeAct(notify, reload);

  return (
    <DataTable
      csvName="reservations"
      rows={rows}
      empty="Aucune réservation."
      columns={[
        { key: 'id', label: '#', value: (r) => r.id },
        { key: 'userId', label: 'Client', value: (r) => r.userId, render: (r) => `#${r.userId}` },
        { key: 'serviceName', label: 'Service' },
        { key: 'date', label: 'Date' },
        { key: 'quantity', label: 'Qté', value: (r) => r.quantity },
        { key: 'totalPrice', label: 'Total', value: (r) => Number(r.totalPrice), render: (r) => money(r.totalPrice) },
        { key: 'promoCode', label: 'Code promo', value: (r) => r.promoCode || '', render: (r) => r.promoCode || '—' },
        { key: 'status', label: 'Statut', value: (r) => STATUS_LABEL[r.status] || r.status, render: (r) => <span className={`status ${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span> },
      ]}
      actions={(r) => (r.status !== 'CANCELLED' ? (
        <button className="danger" onClick={() => window.confirm('Annuler cette réservation ?') &&
          act(() => api('booking', 'cancelReservation', { reservationId: r.id }), 'Réservation annulée.')}>Annuler</button>
      ) : null)}
    />
  );
}

/* ---------------- Paiements ---------------- */

function PaymentsAdmin({ api, notify }) {
  const [rows, reload] = useList(api, notify, 'payment', 'getAllPayments', 'payment');
  const act = makeAct(notify, reload);

  return (
    <DataTable
      csvName="paiements"
      rows={rows}
      empty="Aucun paiement."
      columns={[
        { key: 'id', label: '#', value: (p) => p.id },
        { key: 'reservationId', label: 'Réservation', value: (p) => p.reservationId, render: (p) => `#${p.reservationId}` },
        { key: 'amount', label: 'Montant', value: (p) => Number(p.amount), render: (p) => money(p.amount) },
        { key: 'method', label: 'Mode', value: (p) => METHODS[p.method] || p.method, render: (p) => METHODS[p.method] || p.method },
        { key: 'transactionRef', label: 'Référence' },
        { key: 'status', label: 'Statut', value: (p) => PAY_LABEL[p.status] || p.status, render: (p) => <span className={`status ${p.status === 'PAID' ? 'CONFIRMED' : p.status === 'REFUNDED' ? 'CANCELLED' : ''}`}>{PAY_LABEL[p.status] || p.status}</span> },
      ]}
      actions={(p) => (p.status === 'PAID' ? (
        <button className="danger" onClick={() => window.confirm('Rembourser et annuler la réservation ?') &&
          act(() => api('payment', 'refundPayment', { paymentId: p.id }), 'Paiement remboursé.')}>Rembourser</button>
      ) : null)}
    />
  );
}

/* ---------------- Utilisateurs ---------------- */

function UsersAdmin({ api, notify, me }) {
  const [rows, reload] = useList(api, notify, 'user', 'listUsers', 'user');
  const act = makeAct(notify, reload);
  const [pwFor, setPwFor] = useState(null);
  const [pw, setPw] = useState('');

  const savePassword = (u) => (e) => {
    e.preventDefault();
    act(async () => {
      await api('user', 'updateUser', { userId: u.id, password: pw });
      setPwFor(null);
      setPw('');
    }, 'Mot de passe modifié.');
  };

  return (
    <DataTable
      csvName="utilisateurs"
      rows={rows}
      empty="Aucun utilisateur."
      columns={[
        { key: 'id', label: '#', value: (u) => u.id },
        { key: 'name', label: 'Nom' },
        { key: 'email', label: 'Email' },
        { key: 'phone', label: 'Téléphone', value: (u) => u.phone || '', render: (u) => u.phone || '—' },
        { key: 'role', label: 'Rôle' },
      ]}
      actions={(u) => (Number(u.id) !== Number(me.id) ? (
        pwFor === Number(u.id) ? (
          <form className="inline-pw" onSubmit={savePassword(u)}>
            <input type="password" placeholder="Nouveau mot de passe" value={pw}
              onChange={(e) => setPw(e.target.value)} required autoFocus aria-label="Nouveau mot de passe" />
            <button className="primary">Valider</button>
            <button type="button" onClick={() => { setPwFor(null); setPw(''); }}>Annuler</button>
          </form>
        ) : (
          <>
            <button onClick={() => { setPwFor(Number(u.id)); setPw(''); }}>Mot de passe</button>
            <button onClick={() => act(() => api('user', 'updateUser', { userId: u.id, role: u.role === 'ADMIN' ? 'USER' : 'ADMIN' }), 'Rôle modifié.')}>
              {u.role === 'ADMIN' ? 'Rendre USER' : 'Rendre ADMIN'}
            </button>
            <button className="danger" onClick={() => window.confirm(`Supprimer ${u.name} ?`) &&
              act(() => api('user', 'deleteUser', { userId: u.id }), 'Utilisateur supprimé.')}>Supprimer</button>
          </>
        )
      ) : null)}
    />
  );
}

/* ---------------- Avis ---------------- */

function ReviewsAdmin({ api, notify }) {
  const [rows, reload] = useList(api, notify, 'admin', 'getAllReviews', 'review', { limit: 200 });
  const act = makeAct(notify, reload);

  return (
    <DataTable
      csvName="avis"
      rows={rows}
      empty="Aucun avis."
      columns={[
        { key: 'serviceName', label: 'Service' },
        { key: 'userName', label: 'Auteur' },
        { key: 'rating', label: 'Note', value: (r) => Number(r.rating), render: (r) => <Stars value={r.rating} /> },
        { key: 'comment', label: 'Commentaire', value: (r) => r.comment || '', render: (r) => r.comment || '—' },
        { key: 'updatedAt', label: 'Date', value: (r) => r.updatedAt || r.createdAt },
      ]}
      actions={(r) => (
        <button className="danger" onClick={() => window.confirm('Supprimer cet avis ?') &&
          act(() => api('engagement', 'deleteReview', { reviewId: r.id }), 'Avis supprimé.')}>Supprimer</button>
      )}
    />
  );
}

/* ---------------- Codes promo ---------------- */

function todayIsoPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function PromosAdmin({ api, notify }) {
  const [rows, reload] = useList(api, notify, 'admin', 'listPromoCodes', 'promo');
  const act = makeAct(notify, reload);
  const [f, setF] = useState({ code: '', percent: 10, validFrom: todayIsoPlus(0), validTo: todayIsoPlus(30), maxUses: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const create = (e) => {
    e.preventDefault();
    const args = { code: f.code, percent: f.percent, validFrom: f.validFrom, validTo: f.validTo };
    if (f.maxUses) args.maxUses = f.maxUses;
    act(async () => {
      await api('admin', 'createPromoCode', args);
      setF({ ...f, code: '', maxUses: '' });
    }, 'Code promo créé.');
  };

  return (
    <>
      <form className="card formgrid" onSubmit={create}>
        <input placeholder="CODE" value={f.code} onChange={set('code')} maxLength={30} required aria-label="Code" />
        <input type="number" min="1" max="100" placeholder="Remise (%)" value={f.percent} onChange={set('percent')} required aria-label="Pourcentage de remise" />
        <input type="date" value={f.validFrom} onChange={set('validFrom')} required aria-label="Valable du" />
        <input type="date" value={f.validTo} onChange={set('validTo')} required aria-label="Valable jusqu'au" />
        <input type="number" min="1" placeholder="Utilisations max (vide = illimité)" value={f.maxUses} onChange={set('maxUses')} aria-label="Utilisations maximum" />
        <div className="actions"><button className="primary">Créer le code</button></div>
      </form>

      <DataTable
        csvName="codes-promo"
        rows={rows}
        empty="Aucun code promo."
        columns={[
          { key: 'code', label: 'Code' },
          { key: 'percent', label: 'Remise', value: (p) => Number(p.percent), render: (p) => `-${p.percent} %` },
          { key: 'validFrom', label: 'Du' },
          { key: 'validTo', label: 'Au' },
          { key: 'maxUses', label: 'Utilisations', value: (p) => Number(p.usedCount), render: (p) => `${p.usedCount}${p.maxUses ? ` / ${p.maxUses}` : ''}` },
          { key: 'active', label: 'État', value: (p) => (String(p.active) === 'true' ? 'Actif' : 'Inactif'), render: (p) => <span className={`status ${String(p.active) === 'true' ? 'CONFIRMED' : 'CANCELLED'}`}>{String(p.active) === 'true' ? 'Actif' : 'Inactif'}</span> },
        ]}
        actions={(p) => (
          <>
            <button onClick={() => act(() => api('admin', 'setPromoCodeActive', { promoCodeId: p.id, active: String(p.active) !== 'true' }), 'Code promo mis à jour.')}>
              {String(p.active) === 'true' ? 'Désactiver' : 'Activer'}
            </button>
            <button className="danger" onClick={() => window.confirm(`Supprimer le code ${p.code} ?`) &&
              act(() => api('admin', 'deletePromoCode', { promoCodeId: p.id }), 'Code promo supprimé.')}>Supprimer</button>
          </>
        )}
      />
    </>
  );
}

/* ---------------- Journal d'audit ---------------- */

function AuditAdmin({ api, notify }) {
  const [rows] = useList(api, notify, 'admin', 'getAuditLog', 'entry', { limit: 200 });

  return (
    <DataTable
      csvName="journal-audit"
      rows={rows}
      empty="Journal vide."
      columns={[
        { key: 'createdAt', label: 'Date' },
        { key: 'adminName', label: 'Admin', value: (e) => e.adminName || '', render: (e) => e.adminName || '—' },
        { key: 'action', label: 'Action' },
        { key: 'entity', label: 'Élément', value: (e) => `${e.entity} ${e.entityId || ''}`.trim() },
        { key: 'details', label: 'Détails', value: (e) => e.details || '', render: (e) => e.details || '—' },
      ]}
    />
  );
}
