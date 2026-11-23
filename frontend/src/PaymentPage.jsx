import { useEffect, useState } from 'react';

const METHODS = [
  ['CARD', 'Carte bancaire'],
  ['PAYPAL', 'PayPal'],
  ['BANK_TRANSFER', 'Virement bancaire'],
];

const BRANDS = [
  ['VISA', 'Visa'],
  ['MASTERCARD', 'Mastercard'],
  ['CIB', 'CIB'],
  ['EDINAR', 'e-DINAR'],
];

const STATUS_LABEL = { PENDING: 'En attente', CONFIRMED: 'Confirmée', CANCELLED: 'Annulée' };
const money = (n) => `${Number(n).toFixed(2)} TND`;
const digits = (v, max) => String(v || '').replace(/\D/g, '').slice(0, max);

/** Espace le numéro par groupes de 4 pendant la saisie. */
const formatCard = (v) => digits(v, 16).replace(/(.{4})/g, '$1 ').trim();

/** Insère la barre de la date d'expiration automatiquement (MM/AA). */
const formatExpiry = (v) => {
  const d = digits(v, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};

/** Somme de contrôle de Luhn : détecte une faute de frappe sur un numéro de carte. */
function luhn(num) {
  let sum = 0;
  for (let i = 0; i < num.length; i++) {
    let n = Number(num[num.length - 1 - i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return num.length > 0 && sum % 10 === 0;
}

/** Visa : commence par 4. Mastercard : 51–55 ou 2221–2720. */
function brandFromNumber(num) {
  if (num.startsWith('4')) return 'VISA';
  const two = Number(num.slice(0, 2));
  if (two >= 51 && two <= 55) return 'MASTERCARD';
  const four = Number(num.slice(0, 4));
  if (num.length >= 4 && four >= 2221 && four <= 2720) return 'MASTERCARD';
  return null;
}

/** Date valide : mois 01–12 et mois d'expiration non dépassé. */
function expiryOk(value) {
  const m = /^(\d{2})\/(\d{2})$/.exec(value);
  if (!m) return false;
  const month = Number(m[1]);
  if (month < 1 || month > 12) return false;
  return new Date(2000 + Number(m[2]), month, 1) > new Date();
}

export default function PaymentPage({ api, notify, reservation, ttl, onBack, onPaid }) {
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | blocked | error
  const [method, setMethod] = useState('CARD');
  const [brand, setBrand] = useState(null);
  // Données de carte : état local uniquement, jamais envoyées ni stockées ailleurs.
  const [card, setCard] = useState({ holder: '', number: '', expiry: '', cvv: '' });
  const [fail, setFail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // On recharge la réservation : elle a pu être payée, annulée ou expirée entre-temps.
  useEffect(() => {
    (async () => {
      try {
        const r = await api('booking', 'getReservation', { reservationId: reservation.id });
        setData(r.reservation);
        setState(r.reservation.status === 'PENDING' ? 'ready' : 'blocked');
      } catch (e) {
        notify(e.message, true);
        setState('error');
      }
    })();
  }, []);

  const numberDigits = digits(card.number, 16);
  const holderOk = /^[A-Za-zÀ-ÖØ-öø-ÿ' -]{2,}$/.test(card.holder.trim());
  const numberOk = numberDigits.length === 16 && luhn(numberDigits);
  const cvvOk = /^\d{3}$/.test(card.cvv);
  const dateOk = expiryOk(card.expiry);
  const cardValid = holderOk && numberOk && cvvOk && dateOk;

  const setNumber = (e) => {
    const next = formatCard(e.target.value);
    setCard({ ...card, number: next });
    // Visa / Mastercard se sélectionnent d'eux-mêmes d'après le numéro.
    const detected = brandFromNumber(digits(next, 16));
    if (detected) setBrand(detected);
  };

  const pay = async (e) => {
    e.preventDefault();
    if (busy || (method === 'CARD' && !cardValid)) return;
    setBusy(true);
    setError('');
    try {
      // Seuls l'identifiant, le moyen de paiement et le mode test traversent le réseau.
      const res = await api('payment', 'createPayment', { reservationId: data.id, method, simulateFailure: fail });
      if (res.payment.status === 'PAID') {
        notify('Paiement accepté : réservation confirmée.');
        onPaid();
      } else {
        setError('Paiement refusé. Vous pouvez réessayer.');
      }
    } catch (err) {
      notify(err.message, true);
      onBack();
    } finally {
      setBusy(false);
    }
  };

  const buttonLabel = () => {
    if (busy) return 'Paiement en cours…';
    if (method === 'PAYPAL') return 'Payer avec PayPal';
    if (method === 'BANK_TRANSFER') return "J'ai effectué le virement";
    return `Payer ${money(data?.totalPrice || 0)}`;
  };

  const masked =
    `•••• •••• •••• ${numberDigits.slice(12).padEnd(4, '•')}`;
  const brandLabel = (BRANDS.find(([id]) => id === brand) || [null, 'Carte'])[1];

  if (state === 'loading') return <><h1>Paiement</h1><p className="muted">Chargement…</p></>;

  if (state !== 'ready') {
    const message = state === 'blocked'
      ? `Cette réservation est ${STATUS_LABEL[data?.status]?.toLowerCase() || 'indisponible'} : elle ne peut plus être payée.`
      : 'Réservation introuvable ou inaccessible.';
    return (
      <>
        <h1>Paiement</h1>
        <div className="card stack">
          <p>{message}</p>
          <div className="actions"><button className="primary" onClick={onBack}>← Retour à mes réservations</button></div>
        </div>
      </>
    );
  }

  return (
    <>
      <button onClick={onBack}>← Retour à mes réservations</button>
      <h1>Paiement</h1>

      <div className="pay-layout">
        <form className="card pay-form" onSubmit={pay}>
          <div>
            <h3>Paiement sécurisé</h3>
            <p className="pay-note">Paiement simulé : n'entrez pas de vraie carte.</p>
          </div>

          <div className="pay-methods">
            {METHODS.map(([id, label]) => (
              <button key={id} type="button" className={method === id ? 'active' : ''} onClick={() => setMethod(id)}>{label}</button>
            ))}
          </div>

          {method === 'CARD' && (
            <>
              <div className="brand-tiles">
                {BRANDS.map(([id, label]) => (
                  <button key={id} type="button" className={`brand-tile ${brand === id ? 'active' : ''}`} onClick={() => setBrand(id)}>
                    {label}
                  </button>
                ))}
              </div>

              <div className={`card-preview ${brand || ''}`}>
                <div className="card-preview-top"><span>{brandLabel}</span><span className="card-chip" /></div>
                <p className="card-preview-number">{masked}</p>
                <div className="card-preview-bottom">
                  <div><small>Titulaire</small><span>{card.holder || 'NOM PRÉNOM'}</span></div>
                  <div><small>Expiration</small><span>{card.expiry || 'MM/AA'}</span></div>
                </div>
              </div>

              <div className="pay-fields">
                <label className="wide">Nom du titulaire
                  <input value={card.holder} onChange={(e) => setCard({ ...card, holder: e.target.value })}
                    placeholder="Nom inscrit sur la carte" autoComplete="cc-name" />
                  {card.holder && !holderOk && <small className="field-error">Lettres, espaces, tirets et apostrophes uniquement.</small>}
                </label>
                <label className="wide">Numéro de carte
                  <input inputMode="numeric" value={card.number} onChange={setNumber} maxLength={19}
                    placeholder="4242 4242 4242 4242" autoComplete="cc-number" />
                  {card.number && !numberOk && <small className="field-error">Numéro de carte invalide (16 chiffres).</small>}
                </label>
                <label>Date d'expiration
                  <input inputMode="numeric" value={card.expiry} maxLength={5}
                    onChange={(e) => setCard({ ...card, expiry: formatExpiry(e.target.value) })}
                    placeholder="MM/AA" autoComplete="cc-exp" />
                  {card.expiry && !dateOk && <small className="field-error">Date invalide ou dépassée.</small>}
                </label>
                <label>Code CVV
                  <input inputMode="numeric" type="password" value={card.cvv} maxLength={3}
                    onChange={(e) => setCard({ ...card, cvv: digits(e.target.value, 3) })}
                    placeholder="123" autoComplete="cc-csc" />
                  {card.cvv && !cvvOk && <small className="field-error">3 chiffres.</small>}
                </label>
              </div>

              <p className="muted">Carte de test : 4242 4242 4242 4242, date future, CVV 123.</p>
            </>
          )}

          {method === 'PAYPAL' && (
            <p className="muted">Vous serez débité via votre compte PayPal — simulation. Aucun compte réel n'est contacté.</p>
          )}

          {method === 'BANK_TRANSFER' && (
            <>
              <p className="muted">Coordonnées fictives, pour la démonstration uniquement :</p>
              <ul className="bank-details">
                <li><span>Bénéficiaire</span><b>Booking SOAP SARL</b></li>
                <li><span>Banque</span><b>Banque de Tunisie (fictive)</b></li>
                <li><span>IBAN (fictif)</span><b>TN59 1000 6035 1835 9847 8831</b></li>
                <li><span>Référence à indiquer</span><b>RES-{data.id}</b></li>
              </ul>
            </>
          )}

          {error && <div className="banner-error">{error}</div>}

          <label className="check">
            <input type="checkbox" checked={fail} onChange={(e) => setFail(e.target.checked)} /> Simuler un échec de paiement (mode test)
          </label>

          <button className="primary" disabled={busy || (method === 'CARD' && !cardValid)}>{buttonLabel()}</button>
        </form>

        <aside className="card pay-recap">
          <h3>Récapitulatif</h3>
          <dl>
            <dt>Service</dt><dd>{data.serviceName}</dd>
            <dt>Type</dt><dd>{data.serviceType}</dd>
            <dt>Date</dt><dd>{data.date}</dd>
            <dt>Quantité</dt><dd>{data.quantity}</dd>
            <dt>Réservation</dt><dd>n°{data.id}</dd>
          </dl>
          <div className="pay-total"><span>Total</span><b>{money(data.totalPrice)}</b></div>
          <p className="muted">Réservation annulée automatiquement si elle n'est pas payée dans les {ttl} minutes.</p>
        </aside>
      </div>
    </>
  );
}
