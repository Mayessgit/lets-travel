import { useState } from "react";
import { list } from "./soap";

const TYPE_LABEL = { HOTEL: "Hôtel", FLIGHT: "Vol", EVENT: "Événement" };
const ICONS = { HOTEL: "🏨", FLIGHT: "✈️", EVENT: "🎭" };
const money = (n) => `${Number(n).toFixed(2)} TND`;
const round2 = (n) => Math.round(n * 100) / 100;

/** Image du service : la sienne, sinon l'image par défaut du type, sinon une icône. */
function Thumb({ service }) {
  const sources = [
    service.imageUrl,
    `/images/${service.type.toLowerCase()}.jpg`,
  ].filter(Boolean);
  const [i, setI] = useState(0);
  return (
    <div className={`thumb ${service.type}`}>
      {i < sources.length ? (
        <img
          src={sources[i]}
          alt={service.name}
          loading="lazy"
          onError={() => setI(i + 1)}
        />
      ) : (
        ICONS[service.type]
      )}
    </div>
  );
}

/** Étoiles en lecture seule (note sur 5). */
export function Stars({ value, count }) {
  const filled = Math.round(Number(value) || 0);
  return (
    <span
      className="stars"
      aria-label={`Note ${Number(value || 0).toFixed(1)} sur 5`}
    >
      <span aria-hidden="true">
        {"★".repeat(filled)}
        <span className="stars-off">{"★".repeat(5 - filled)}</span>
      </span>
      {count !== undefined && (
        <small>
          {Number(value || 0).toFixed(1)} · {Number(count)} avis
        </small>
      )}
    </span>
  );
}

export default function ServiceCard({
  service,
  api,
  notify,
  session,
  goLogin,
  ttl,
  isFavorite,
  onToggleFavorite,
}) {
  const [slots, setSlots] = useState(null); // null = panneau fermé
  const [qty, setQty] = useState({});
  const [busy, setBusy] = useState(null);
  const [promo, setPromo] = useState(null); // { code, percent }
  const [promoInput, setPromoInput] = useState("");
  const [promoBusy, setPromoBusy] = useState(false);
  const [showReviews, setShowReviews] = useState(false);
  const [reviews, setReviews] = useState(null);
  const [form, setForm] = useState({ rating: 5, comment: "" });
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewDeleteBusy, setReviewDeleteBusy] = useState(null);

  const loadSlots = (open) =>
    open
      ? api("availability", "getAvailableSlots", {
          serviceId: service.id,
        }).then((r) => setSlots(list(r?.availability)))
      : Promise.resolve();

  const toggle = async () => {
    if (slots) return setSlots(null);
    try {
      await loadSlots(true);
    } catch (e) {
      notify(e.message, true);
    }
  };

  // On reste sur la page : la liste des dates est rechargée pour refléter les places restantes.
  const book = async (av) => {
    if (!session) return goLogin();
    setBusy(av.id);
    try {
      const args = { availabilityId: av.id, quantity: qty[av.id] || 1 };
      if (promo) args.promoCode = promo.code;
      await api("booking", "createReservation", args);
      notify(
        `Réservation créée. Retrouvez-la dans « Mes réservations » : elle sera annulée automatiquement si elle n'est pas payée dans les ${ttl} minutes.`,
      );
      setQty({ ...qty, [av.id]: 1 });
      await loadSlots(true);
    } catch (e) {
      notify(e.message, true);
    } finally {
      setBusy(null);
    }
  };

  const applyPromo = async (e) => {
    e.preventDefault();
    if (!session) return goLogin();
    if (!promoInput.trim()) return;
    setPromoBusy(true);
    try {
      const r = await api("engagement", "checkPromoCode", { code: promoInput });
      setPromo({ code: r.code, percent: Number(r.percent) });
      notify(`Code ${r.code} appliqué : -${r.percent} %.`);
    } catch (err) {
      setPromo(null);
      notify(err.message, true);
    } finally {
      setPromoBusy(false);
    }
  };

  // Prix d'un créneau pour la quantité saisie, remise déduite si un code est appliqué.
  const priceOf = (av) => {
    const base = Number(service.price) * (Number(qty[av.id]) || 1);
    return promo ? round2(base * (1 - promo.percent / 100)) : round2(base);
  };

  const openReviews = async () => {
    if (showReviews) return setShowReviews(false);
    setShowReviews(true);
    if (reviews) return;
    try {
      const r = await api("engagement", "getServiceReviews", {
        serviceId: service.id,
        limit: 20,
      });
      setReviews({
        items: list(r?.review),
        average: Number(r?.averageRating || 0),
        count: Number(r?.reviewCount || 0),
      });
    } catch (e) {
      notify(e.message, true);
      setReviews({ items: [], average: 0, count: 0 });
    }
  };

  const submitReview = async (e) => {
    e.preventDefault();
    if (!session) return goLogin();
    setReviewBusy(true);
    try {
      await api("engagement", "saveReview", {
        serviceId: service.id,
        rating: form.rating,
        comment: form.comment,
      });
      notify("Merci pour votre avis !");
      setForm({ rating: 5, comment: "" });
      const r = await api("engagement", "getServiceReviews", {
        serviceId: service.id,
        limit: 20,
      });
      setReviews({
        items: list(r?.review),
        average: Number(r?.averageRating || 0),
        count: Number(r?.reviewCount || 0),
      });
    } catch (err) {
      notify(err.message, true); // NOT_ELIGIBLE : réservation confirmée requise
    } finally {
      setReviewBusy(false);
    }
  };

  const deleteOwnReview = async (review) => {
    if (!window.confirm("Supprimer votre avis ?")) return;
    setReviewDeleteBusy(review.id);
    try {
      await api("engagement", "deleteReview", { reviewId: review.id });
      notify("Votre avis a été supprimé.");
      setReviews(
        (current) =>
          current && {
            ...current,
            items: current.items.filter((item) => item.id !== review.id),
          },
      );
      const r = await api("engagement", "getServiceReviews", {
        serviceId: service.id,
        limit: 20,
      });
      setReviews({
        items: list(r?.review),
        average: Number(r?.averageRating || 0),
        count: Number(r?.reviewCount || 0),
      });
    } catch (err) {
      notify(err.message, true);
    } finally {
      setReviewDeleteBusy(null);
    }
  };

  const reviewStats = reviews || {
    average: Number(service.averageRating || 0),
    count: Number(service.reviewCount || 0),
  };

  return (
    <article className="card service">
      <div className="thumb-wrap">
        <Thumb service={service} />
        <button
          className={`fav ${isFavorite ? "on" : ""}`}
          onClick={() => onToggleFavorite(service)}
          aria-label={
            isFavorite
              ? `Retirer ${service.name} des favoris`
              : `Ajouter ${service.name} aux favoris`
          }
          aria-pressed={isFavorite}
        >
          {isFavorite ? "♥" : "♡"}
        </button>
      </div>

      <div className="body">
        <span className={`tag ${service.type}`}>
          {TYPE_LABEL[service.type]}
        </span>
        <h3>{service.name}</h3>
        <p className="muted">📍 {service.location}</p>
        {service.description && <p>{service.description}</p>}
        {reviewStats.count ? (
          <Stars value={reviewStats.average} count={reviewStats.count} />
        ) : (
          <p className="muted small">Aucun avis pour le moment</p>
        )}
        <p className="price">
          <small>À partir de</small> {money(service.price)}
        </p>

        <div className="actions">
          <button onClick={toggle}>
            {slots ? "Masquer les dates" : "Voir les dates"}
          </button>
          <button onClick={openReviews} aria-expanded={showReviews}>
            Avis{reviewStats.count ? ` (${reviewStats.count})` : ""}
          </button>
        </div>

        {slots && (
          <div className="slots">
            <form className="promo-box" onSubmit={applyPromo}>
              <input
                placeholder="Code promo"
                value={promoInput}
                onChange={(e) => setPromoInput(e.target.value)}
                aria-label="Code promo"
                maxLength={30}
              />
              <button
                className="primary"
                disabled={promoBusy || !promoInput.trim()}
              >
                Appliquer
              </button>
              {promo && (
                <button
                  type="button"
                  onClick={() => {
                    setPromo(null);
                    setPromoInput("");
                  }}
                >
                  Retirer
                </button>
              )}
            </form>
            {promo && (
              <p className="muted small">
                Code <b>{promo.code}</b> : -{promo.percent} % sur le total.
              </p>
            )}

            {slots.length === 0 && (
              <p className="muted">Aucune date disponible.</p>
            )}
            {slots.map((av) => (
              <div className="slot" key={av.id}>
                <span>
                  <b>{av.date}</b> · {av.availableSlots} place(s)
                  <br />
                  {promo ? (
                    <>
                      <s className="muted">
                        {money(
                          Number(service.price) * (Number(qty[av.id]) || 1),
                        )}
                      </s>{" "}
                      <b className="promo-price">{money(priceOf(av))}</b>
                    </>
                  ) : (
                    <b>{money(priceOf(av))}</b>
                  )}
                </span>
                <input
                  type="number"
                  min="1"
                  max={av.availableSlots}
                  aria-label={`Quantité pour le ${av.date}`}
                  value={qty[av.id] || 1}
                  onChange={(e) => setQty({ ...qty, [av.id]: e.target.value })}
                />
                <button
                  className="primary"
                  onClick={() => book(av)}
                  disabled={busy === av.id}
                >
                  {busy === av.id ? "Réservation…" : "Réserver"}
                </button>
              </div>
            ))}
          </div>
        )}

        {showReviews && (
          <div className="reviews">
            <h4>Avis des voyageurs</h4>
            {!reviews && <p className="muted">Chargement…</p>}
            {reviews && reviews.items.length === 0 && (
              <p className="muted">Aucun avis pour l'instant.</p>
            )}
            {reviews && reviews.items.length > 0 && (
              <ul className="review-list">
                {reviews.items.map((r) => (
                  <li key={r.id}>
                    <div className="row-between">
                      <b>{r.userName}</b>
                      <Stars value={r.rating} />
                    </div>
                    {r.comment && <p>{r.comment}</p>}
                    {session &&
                      Number(r.userId) === Number(session.user.id) && (
                        <button
                          type="button"
                          className="danger"
                          disabled={reviewDeleteBusy !== null}
                          onClick={() => deleteOwnReview(r)}
                        >
                          {reviewDeleteBusy === r.id
                            ? "Suppression…"
                            : "Supprimer mon avis"}
                        </button>
                      )}
                  </li>
                ))}
              </ul>
            )}

            <form className="review-form" onSubmit={submitReview}>
              <div
                className="rating-picker"
                role="radiogroup"
                aria-label="Votre note"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={form.rating === n}
                    aria-label={`${n} étoile${n > 1 ? "s" : ""}`}
                    className={n <= form.rating ? "on" : ""}
                    onClick={() => setForm({ ...form, rating: n })}
                  >
                    ★
                  </button>
                ))}
              </div>
              <textarea
                rows="2"
                placeholder="Votre commentaire (facultatif)"
                maxLength={1000}
                value={form.comment}
                onChange={(e) => setForm({ ...form, comment: e.target.value })}
              />
              <button className="primary" disabled={reviewBusy}>
                {reviewBusy ? "Envoi…" : "Publier mon avis"}
              </button>
              <small className="muted">
                Seuls les clients ayant une réservation confirmée pour ce
                service peuvent noter.
              </small>
            </form>
          </div>
        )}
      </div>
    </article>
  );
}
