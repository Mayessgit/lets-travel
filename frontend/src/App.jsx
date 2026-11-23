import { useEffect, useState } from "react";
import { soap, list } from "./soap";
import AdminPage from "./AdminPage.jsx";
import ProfilePage, { Avatar } from "./ProfilePage.jsx";
import PaymentPage from "./PaymentPage.jsx";
import ServiceCard from "./ServiceCard.jsx";
import { FavoritesPage, PaymentsPage, InvoicePage } from "./AccountPages.jsx";
import Notifications from "./Notifications.jsx";
import { PHONE_ERROR, isValidPhone, sanitizePhone } from "./phone";
import { initialTheme, applyTheme } from "./theme";

const TYPES = { HOTEL: "Hôtel", FLIGHT: "Vol", EVENT: "Événement" };
const STATUS = {
  PENDING: "En attente",
  CONFIRMED: "Confirmée",
  CANCELLED: "Annulée",
};
const SORTS = {
  "": "Tri : pertinence",
  price_asc: "Prix croissant",
  price_desc: "Prix décroissant",
  rating: "Meilleures notes",
  name: "Nom (A → Z)",
};
const money = (n) => `${Number(n).toFixed(2)} TND`;
// Doit rester aligné sur RESERVATION_TTL_MINUTES du backend (2 par défaut).
const TTL_MINUTES = Number(import.meta.env.VITE_RESERVATION_TTL_MINUTES) || 2;

export default function App() {
  const [session, setSession] = useState(() =>
    JSON.parse(localStorage.getItem("session") || "null"),
  );
  const [page, setPage] = useState("services");
  const [payTarget, setPayTarget] = useState(null); // réservation en cours de paiement
  const [invoice, setInvoice] = useState(null); // paiement à imprimer
  const [toast, setToast] = useState(null);
  const [theme, setTheme] = useState(initialTheme);
  const [favIds, setFavIds] = useState(new Set());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const notify = (text, error = false) => {
    setToast({ text, error });
    setTimeout(() => setToast(null), 4000);
  };
  const login = (s) => {
    localStorage.setItem("session", JSON.stringify(s));
    setSession(s);
    setPage("services");
  };
  const logout = () => {
    localStorage.removeItem("session");
    setSession(null);
    setFavIds(new Set());
    setPage("services");
  };
  // Met à jour l'utilisateur de la session (après modification du profil)
  const updateUser = (user) => {
    const next = { ...session, user };
    localStorage.setItem("session", JSON.stringify(next));
    setSession(next);
  };

  // Appel SOAP avec le token de la session ; un token refusé déconnecte l'utilisateur.
  const api = async (service, op, args) => {
    try {
      return await soap(service, op, args, session?.token);
    } catch (e) {
      if (e.code === "INVALID_TOKEN") {
        logout();
        notify("Session expirée, reconnectez-vous.", true);
      }
      throw e;
    }
  };

  // Favoris : chargés à la connexion, partagés entre la liste et « Mes favoris ».
  const loadFavorites = async () => {
    if (!session) return setFavIds(new Set());
    try {
      const r = await api("engagement", "getFavorites");
      setFavIds(new Set(list(r?.service).map((s) => s.id)));
    } catch {
      /* silencieux : le cœur n'est qu'un confort */
    }
  };
  useEffect(() => {
    loadFavorites();
  }, [session?.token]);

  const toggleFavorite = async (service) => {
    if (!session) return setPage("auth");
    const isFav = favIds.has(service.id);
    try {
      await api("engagement", isFav ? "removeFavorite" : "addFavorite", {
        serviceId: service.id,
      });
      setFavIds((prev) => {
        const next = new Set(prev);
        if (isFav) next.delete(service.id);
        else next.add(service.id);
        return next;
      });
      notify(isFav ? "Retiré de vos favoris." : "Ajouté à vos favoris.");
    } catch (e) {
      notify(e.message, true);
    }
  };

  // Facture : le paiement lié à la réservation est chargé avant l'affichage.
  const openInvoice = async (reservation) => {
    try {
      const r = await api("payment", "getPaymentByReservation", {
        reservationId: reservation.id,
      });
      setInvoice({
        ...r.payment,
        serviceName: r.payment.serviceName || reservation.serviceName,
        date: reservation.date,
      });
      setPage("invoice");
    } catch (e) {
      notify(e.message, true);
    }
  };

  const ctx = { api, notify, session };

  return (
    <>
      <header className="bar">
        <strong className="brand" onClick={() => setPage("services")}>
          ✈ Let's Travel
        </strong>
        <nav>
          <button onClick={() => setPage("services")}>Services</button>
          {session && (
            <button onClick={() => setPage("favorites")}>Mes favoris</button>
          )}
          {session && (
            <button onClick={() => setPage("reservations")}>
              Mes réservations
            </button>
          )}
          {session && (
            <button onClick={() => setPage("payments")}>Mes paiements</button>
          )}
          {session?.user.role === "ADMIN" && (
            <button onClick={() => setPage("admin")}>Administration</button>
          )}
        </nav>
        <div className="grow" />
        {session && <Notifications api={api} notify={notify} />}
        <button
          className="icon-btn"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label={
            theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"
          }
          aria-pressed={theme === "dark"}
          title={theme === "dark" ? "Mode clair" : "Mode sombre"}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
        {session ? (
          <>
            <button
              className="me"
              onClick={() => setPage("profile")}
              title="Mon profil"
            >
              <Avatar user={session.user} size={30} />
              <span className="who">{session.user.name}</span>
            </button>
            <button onClick={logout}>Déconnexion</button>
          </>
        ) : (
          <button className="primary" onClick={() => setPage("auth")}>
            Connexion
          </button>
        )}
      </header>

      <main>
        {page === "services" && (
          <ServicesPage
            {...ctx}
            goLogin={() => setPage("auth")}
            ttl={TTL_MINUTES}
            favIds={favIds}
            onToggleFavorite={toggleFavorite}
          />
        )}
        {page === "favorites" && session && (
          <FavoritesPage
            {...ctx}
            goServices={() => setPage("services")}
            onRemove={(id) =>
              setFavIds((prev) => {
                const n = new Set(prev);
                n.delete(id);
                return n;
              })
            }
          />
        )}
        {page === "reservations" && session && (
          <ReservationsPage
            {...ctx}
            ttl={TTL_MINUTES}
            goPay={(r) => {
              setPayTarget(r);
              setPage("payment");
            }}
            goInvoice={openInvoice}
          />
        )}
        {page === "payments" && session && (
          <PaymentsPage
            {...ctx}
            goServices={() => setPage("services")}
            onInvoice={(p) => {
              setInvoice(p);
              setPage("invoice");
            }}
          />
        )}
        {page === "payment" && session && payTarget && (
          <PaymentPage
            {...ctx}
            reservation={payTarget}
            ttl={TTL_MINUTES}
            onBack={() => setPage("reservations")}
            onPaid={() => {
              setPayTarget(null);
              setPage("reservations");
            }}
          />
        )}
        {page === "invoice" && session && invoice && (
          <InvoicePage
            payment={invoice}
            session={session}
            onBack={() => setPage("payments")}
          />
        )}
        {page === "admin" && session?.user.role === "ADMIN" && (
          <AdminPage {...ctx} />
        )}
        {page === "profile" && session && (
          <ProfilePage {...ctx} onUser={updateUser} onDeleted={logout} />
        )}
        {page === "auth" && <AuthPage {...ctx} onLogin={login} />}
      </main>

      {toast && (
        <div className={`toast ${toast.error ? "err" : ""}`}>{toast.text}</div>
      )}
    </>
  );
}

/* ---------------- Recherche et réservation ---------------- */

const PAGE_SIZE = 12;

function ServicesPage({
  api,
  notify,
  session,
  goLogin,
  ttl,
  favIds,
  onToggleFavorite,
}) {
  const [filters, setFilters] = useState({
    keyword: "",
    type: "",
    maxPrice: "",
    minRating: "",
    sortBy: "",
  });
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);

  const args = (p) => {
    const out = { limit: PAGE_SIZE, offset: p * PAGE_SIZE };
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== "" && v != null) out[k] = v;
    });
    return out;
  };

  const search = async (e, p = 0) => {
    e?.preventDefault();
    setBusy(true);
    try {
      const r = await api("availability", "searchServices", args(p));
      const rows = list(r?.service);
      setItems((prev) => (p === 0 ? rows : [...(prev || []), ...rows]));
      setTotal(Number(r?.total || 0));
      setPage(p);
    } catch (err) {
      notify(err.message, true);
      if (p === 0) {
        setItems([]);
        setTotal(0);
      }
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    search();
  }, []);

  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });
  const reset = () => {
    const empty = {
      keyword: "",
      type: "",
      maxPrice: "",
      minRating: "",
      sortBy: "",
    };
    setFilters(empty);
    // On relance avec les filtres vidés (state pas encore à jour).
    setBusy(true);
    api("availability", "searchServices", { limit: PAGE_SIZE, offset: 0 })
      .then((r) => {
        setItems(list(r?.service));
        setTotal(Number(r?.total || 0));
        setPage(0);
      })
      .catch((err) => notify(err.message, true))
      .finally(() => setBusy(false));
  };

  const chips = [
    filters.keyword && { key: "keyword", label: `« ${filters.keyword} »` },
    filters.type && { key: "type", label: TYPES[filters.type] },
    filters.maxPrice && { key: "maxPrice", label: `≤ ${filters.maxPrice} TND` },
    filters.minRating && {
      key: "minRating",
      label: `${filters.minRating}★ et plus`,
    },
    filters.sortBy && { key: "sortBy", label: SORTS[filters.sortBy] },
  ].filter(Boolean);

  return (
    <>
      <section className="hero">
        <h1>Trouvez votre prochain séjour, vol ou événement</h1>
        <p>
          Hôtels, vols et événements au même endroit, avec confirmation
          immédiate.
        </p>
      </section>

      <form className="filters searchbar" onSubmit={(e) => search(e, 0)}>
        <input
          placeholder="Mot-clé (nom, description)"
          value={filters.keyword}
          onChange={set("keyword")}
          aria-label="Mot-clé"
        />
        <select
          value={filters.type}
          onChange={set("type")}
          aria-label="Type de service"
        >
          <option value="">Tous les types</option>
          {Object.entries(TYPES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="0"
          placeholder="Prix max"
          value={filters.maxPrice}
          onChange={set("maxPrice")}
          aria-label="Prix maximum"
        />
        <select
          value={filters.minRating}
          onChange={set("minRating")}
          aria-label="Note minimale"
        >
          <option value="">Toutes les notes</option>
          <option value="3">3★ et plus</option>
          <option value="4">4★ et plus</option>
          <option value="5">5★</option>
        </select>
        <select
          value={filters.sortBy}
          onChange={set("sortBy")}
          aria-label="Trier par"
        >
          {Object.entries(SORTS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button className="primary">Rechercher</button>
      </form>

      {chips.length > 0 && (
        <div className="chips">
          {chips.map((c) => (
            <button
              key={c.key}
              className="chip"
              onClick={() => setFilters({ ...filters, [c.key]: "" })}
              aria-label={`Retirer le filtre ${c.label}`}
            >
              {c.label} ✕
            </button>
          ))}
          <button className="link" onClick={reset}>
            Réinitialiser
          </button>
        </div>
      )}

      {items === null && <p className="muted">Chargement…</p>}
      {items?.length === 0 && (
        <p className="muted">Aucun service ne correspond à votre recherche.</p>
      )}
      <div className="grid">
        {items?.map((s) => (
          <ServiceCard
            key={s.id}
            service={s}
            {...{ api, notify, session, goLogin, ttl }}
            isFavorite={favIds.has(s.id)}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
      </div>

      {items && items.length > 0 && (
        <div className="more-row">
          <span className="muted">
            {items.length} sur {total} service(s)
          </span>
          {items.length < total && (
            <button
              className="primary"
              onClick={() => search(null, page + 1)}
              disabled={busy}
            >
              {busy ? "Chargement…" : "Voir plus"}
            </button>
          )}
        </div>
      )}
    </>
  );
}

/* ---------------- Mes réservations ---------------- */

function ReservationsPage({ api, notify, goPay, goInvoice, ttl }) {
  const [items, setItems] = useState(null);
  const [qty, setQty] = useState({}); // { [reservationId]: quantité en cours d'édition }

  const load = async () => {
    try {
      const r = await api("booking", "getUserReservations", {});
      setItems(list(r?.reservation));
    } catch (e) {
      notify(e.message, true);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const act = async (fn, okMessage) => {
    try {
      await fn();
      notify(okMessage);
    } catch (e) {
      notify(e.message, true);
    }
    load();
  };

  const cancel = (r) => {
    if (!window.confirm("Annuler cette réservation ?")) return;
    act(
      () => api("booking", "cancelReservation", { reservationId: r.id }),
      "Réservation annulée.",
    );
  };

  const saveQty = (r) => {
    act(async () => {
      await api("booking", "updateReservation", {
        reservationId: r.id,
        quantity: Number(qty[r.id]),
      });
      setQty({ ...qty, [r.id]: undefined });
    }, "Quantité mise à jour.");
  };

  return (
    <>
      <h1>Mes réservations</h1>
      <p className="muted">
        ⏱ Une réservation non payée est annulée automatiquement après {ttl}{" "}
        minutes.
      </p>
      {items === null && <p className="muted">Chargement…</p>}
      {items?.length === 0 && (
        <p className="muted">Vous n'avez aucune réservation.</p>
      )}
      <div className="list">
        {items?.map((r) => (
          <article className="card row" key={r.id}>
            <div className="grow">
              <h3>
                {r.serviceName}{" "}
                <span className={`status ${r.status}`}>{STATUS[r.status]}</span>
              </h3>
              <p className="muted">
                Date : {r.date} · Quantité : {r.quantity} · Réservation n°{r.id}
              </p>
              {r.promoCode && (
                <p className="muted">
                  Code {r.promoCode} appliqué : -{money(r.discountAmount)}
                </p>
              )}
              <p className="price">{money(r.totalPrice)}</p>

              {r.status === "PENDING" && qty[r.id] !== undefined && (
                <div className="qty-edit">
                  <input
                    type="number"
                    min="1"
                    value={qty[r.id]}
                    aria-label="Nouvelle quantité"
                    onChange={(e) => setQty({ ...qty, [r.id]: e.target.value })}
                  />
                  <button className="primary" onClick={() => saveQty(r)}>
                    Valider
                  </button>
                  <button onClick={() => setQty({ ...qty, [r.id]: undefined })}>
                    Annuler
                  </button>
                </div>
              )}
            </div>
            <div className="actions">
              {r.status === "PENDING" && (
                <button className="primary" onClick={() => goPay(r)}>
                  Payer
                </button>
              )}
              {r.status === "PENDING" && (
                <button onClick={() => setQty({ ...qty, [r.id]: r.quantity })}>
                  Modifier la quantité
                </button>
              )}
              {r.status === "CONFIRMED" && (
                <button onClick={() => goInvoice(r)}>Facture</button>
              )}
              {r.status !== "CANCELLED" && (
                <button className="danger" onClick={() => cancel(r)}>
                  Annuler
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

/* ---------------- Connexion / inscription ---------------- */

function AuthPage({ api, notify, onLogin }) {
  const [mode, setMode] = useState("login");
  const [f, setF] = useState({ name: "", email: "", password: "", phone: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const phoneError =
    mode === "register" && !isValidPhone(f.phone) ? PHONE_ERROR : "";

  const submit = async (e) => {
    e.preventDefault();
    if (phoneError) return notify(PHONE_ERROR, true);
    try {
      if (mode === "register") await api("user", "registerUser", f);
      const r = await api("user", "loginUser", {
        email: f.email,
        password: f.password,
      });
      onLogin({ token: r.token, user: r.user });
      notify(`Bienvenue ${r.user.name} !`);
    } catch (err) {
      notify(err.message, true);
    }
  };

  return (
    <form className="auth card" onSubmit={submit}>
      <h1>{mode === "login" ? "Connexion" : "Créer un compte"}</h1>
      {mode === "register" && (
        <input
          placeholder="Nom complet"
          value={f.name}
          onChange={set("name")}
          required
        />
      )}
      <input
        type="email"
        placeholder="Email"
        value={f.email}
        onChange={set("email")}
        required
      />
      <input
        type="password"
        placeholder="Mot de passe"
        value={f.password}
        onChange={set("password")}
        required
      />
      {mode === "register" && (
        <>
          <input
            placeholder="Ex : 22 123 456"
            inputMode="numeric"
            maxLength={8}
            value={f.phone}
            onChange={(e) =>
              setF({ ...f, phone: sanitizePhone(e.target.value) })
            }
          />
          {phoneError && <small className="field-error">{phoneError}</small>}
          <small className="muted">
            8 chiffres, commençant par 20–29, 50–59 ou 90–99.
          </small>
          <small className="muted">
            Mot de passe : 8 caractères minimum, avec une lettre et un chiffre.
          </small>
        </>
      )}
      <button className="primary">
        {mode === "login" ? "Se connecter" : "S'inscrire"}
      </button>
      <button
        type="button"
        className="link"
        onClick={() => setMode(mode === "login" ? "register" : "login")}
      >
        {mode === "login"
          ? "Pas de compte ? Inscrivez-vous"
          : "Déjà inscrit ? Connectez-vous"}
      </button>
    </form>
  );
}
