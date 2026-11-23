import { useEffect, useState } from 'react';
import { list } from './soap';
import DataTable from './DataTable.jsx';
import { Stars } from './ServiceCard.jsx';

const money = (n) => `${Number(n).toFixed(2)} TND`;
const TYPE_LABEL = { HOTEL: 'Hôtel', FLIGHT: 'Vol', EVENT: 'Événement' };
const PAY_STATUS = { PAID: 'Payé', FAILED: 'Refusé', REFUNDED: 'Remboursé', PENDING: 'En attente' };
const METHODS = { CARD: 'Carte bancaire', PAYPAL: 'PayPal', BANK_TRANSFER: 'Virement bancaire' };
const dayFmt = (value) => {
  const d = new Date(String(value || '').replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? String(value || '') : d.toLocaleDateString('fr-FR');
};

/* ---------------- Mes favoris ---------------- */

export function FavoritesPage({ api, notify, goServices, onRemove }) {
  const [items, setItems] = useState(null);

  const load = async () => {
    try {
      const r = await api('engagement', 'getFavorites');
      setItems(list(r?.service));
    } catch (e) { notify(e.message, true); setItems([]); }
  };
  useEffect(() => { load(); }, []);

  const remove = async (s) => {
    try {
      await api('engagement', 'removeFavorite', { serviceId: s.id });
      onRemove?.(s.id);
      notify('Retiré de vos favoris.');
      load();
    } catch (e) { notify(e.message, true); }
  };

  return (
    <>
      <h1>Mes favoris</h1>
      <p className="muted">Vos services préférés, prêts à être réservés.</p>
      {items === null && <p className="muted">Chargement…</p>}
      {items?.length === 0 && (
        <div className="card stack">
          <p>Vous n'avez encore aucun favori.</p>
          <div className="actions"><button className="primary" onClick={goServices}>Parcourir les services</button></div>
        </div>
      )}
      <div className="grid">
        {items?.map((s) => (
          <article className="card" key={s.id}>
            <span className={`tag ${s.type}`}>{TYPE_LABEL[s.type]}</span>
            <h3>{s.name}</h3>
            <p className="muted">📍 {s.location}</p>
            {s.reviewCount ? <Stars value={s.averageRating} count={s.reviewCount} /> : null}
            <p className="price">{money(s.price)}</p>
            <div className="actions">
              <button className="primary" onClick={goServices}>Voir les dates</button>
              <button onClick={() => remove(s)} aria-label={`Retirer ${s.name} des favoris`}>Retirer</button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

/* ---------------- Mes paiements ---------------- */

export function PaymentsPage({ api, notify, onInvoice, goServices }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await api('payment', 'getMyPayments');
        setRows(list(r?.payment));
      } catch (e) { notify(e.message, true); setRows([]); }
    })();
  }, []);

  return (
    <>
      <h1>Mes paiements</h1>
      <p className="muted">Historique de vos paiements. Une facture est disponible pour chaque paiement accepté.</p>
      <DataTable
        csvName="mes-paiements"
        rows={rows}
        empty="Aucun paiement pour le moment."
        columns={[
          { key: 'createdAt', label: 'Date', value: (p) => dayFmt(p.createdAt), render: (p) => dayFmt(p.createdAt) },
          { key: 'serviceName', label: 'Service' },
          { key: 'date', label: 'Prestation', value: (p) => p.date || '', render: (p) => p.date || '—' },
          { key: 'amount', label: 'Montant', value: (p) => Number(p.amount), render: (p) => money(p.amount) },
          { key: 'method', label: 'Mode', value: (p) => METHODS[p.method] || p.method, render: (p) => METHODS[p.method] || p.method },
          { key: 'transactionRef', label: 'Référence' },
          { key: 'status', label: 'Statut', value: (p) => PAY_STATUS[p.status] || p.status, render: (p) => <span className={`status ${p.status === 'PAID' ? 'CONFIRMED' : p.status === 'FAILED' ? '' : 'CANCELLED'}`}>{PAY_STATUS[p.status] || p.status}</span> },
        ]}
        actions={(p) => (
          p.status === 'PAID'
            ? <button onClick={() => onInvoice(p)} aria-label={`Facture du paiement ${p.id}`}>Facture</button>
            : null
        )}
      />
      {rows?.length === 0 && (
        <div className="actions"><button className="primary" onClick={goServices}>Réserver un service</button></div>
      )}
    </>
  );
}

/* ---------------- Facture imprimable ---------------- */

export function InvoicePage({ payment, session, onBack }) {
  if (!payment) return null;
  const today = new Date().toLocaleDateString('fr-FR');
  const total = Number(payment.amount);

  return (
    <div className="invoice-wrap">
      <div className="actions no-print">
        <button onClick={onBack}>← Retour</button>
        <button className="primary" onClick={() => window.print()}>🖨 Imprimer / Enregistrer en PDF</button>
      </div>

      <article className="card invoice">
        <header className="invoice-head">
          <div>
            <strong className="invoice-brand">✈ Réservations</strong>
            <p className="muted">Booking SOAP SARL · Avenue Habib Bourguiba, Tunis</p>
          </div>
          <div className="invoice-num">
            <small>Facture</small>
            <b>FAC-{payment.id}</b>
            <span className="muted">Émise le {today}</span>
          </div>
        </header>

        <section className="invoice-parties">
          <div>
            <small className="muted">Client</small>
            <p><b>{session.user.name}</b><br />{session.user.email}</p>
          </div>
          <div>
            <small className="muted">Paiement</small>
            <p>
              {METHODS[payment.method] || payment.method}<br />
              Référence {payment.transactionRef}<br />
              {dayFmt(payment.createdAt)}
            </p>
          </div>
        </section>

        <div className="table">
          <table>
            <thead>
              <tr><th>Prestation</th><th>Date</th><th>Montant</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>{payment.serviceName || 'Réservation'} <span className="muted">(réservation n°{payment.reservationId})</span></td>
                <td>{payment.date || '—'}</td>
                <td>{money(total)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="invoice-total">
          <span>Total réglé</span>
          <b>{money(total)}</b>
        </div>
        <p className="muted small">TVA incluse. Document généré automatiquement, paiement simulé à des fins de démonstration.</p>
      </article>
    </div>
  );
}
