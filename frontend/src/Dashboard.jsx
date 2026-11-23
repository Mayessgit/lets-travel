import { useEffect, useState } from "react";
import { list } from "./soap";

const money = (n) => `${Number(n).toFixed(2)} TND`;
const dayLabel = (iso) =>
  `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}`;
const TYPE_LABELS = { HOTEL: "Hôtels", FLIGHT: "Vols", EVENT: "Événements" };
const TYPE_COLORS = { HOTEL: "#1560d4", FLIGHT: "#0f9d58", EVENT: "#b4308b" };
const METHOD_LABELS = {
  CARD: "Carte bancaire",
  PAYPAL: "PayPal",
  BANK_TRANSFER: "Virement",
};
const STATUS_LABEL = {
  PENDING: "En attente",
  CONFIRMED: "Confirmée",
  CANCELLED: "Annulée",
};
const PERIODS = [7, 30, 90];

/** Évolution en % vs la période précédente ; « — » si celle-ci est vide. */
function Delta({ current, previous }) {
  if (!Number(previous)) return <span className="delta muted">—</span>;
  const pct =
    Math.round(
      ((Number(current) - Number(previous)) / Number(previous)) * 1000,
    ) / 10;
  const up = pct >= 0;
  return (
    <span className={`delta ${up ? "up" : "down"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct)} % <small>vs période précédente</small>
    </span>
  );
}

function RevenueChart({ points }) {
  const W = 660;
  const H = 210;
  const PAD = 34;
  const max = Math.max(1, ...points.map((p) => Number(p.revenue)));
  const step = points.length > 1 ? (W - PAD * 2) / (points.length - 1) : 0;
  const x = (i) => PAD + i * step;
  const y = (v) => H - PAD - (v / max) * (H - PAD * 2);
  const line = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(Number(p.revenue)).toFixed(1)}`,
    )
    .join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`;
  const ticks = [0, Math.floor(points.length / 2), points.length - 1].filter(
    (v, i, a) => a.indexOf(v) === i && points[v],
  );

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="chart"
      role="img"
      aria-label="Revenu par jour sur la période"
    >
      {[0, 0.5, 1].map((r) => (
        <line
          key={r}
          x1={PAD}
          x2={W - PAD}
          y1={y(max * r)}
          y2={y(max * r)}
          className="grid"
        />
      ))}
      <path d={area} className="area" />
      <path d={line} className="line" />
      {points.map((p, i) => (
        <circle
          key={p.date}
          cx={x(i)}
          cy={y(Number(p.revenue))}
          r="3.5"
          className="dot"
        >
          <title>{`${p.date} : ${money(p.revenue)} · ${p.reservations} réservation(s)`}</title>
        </circle>
      ))}
      {ticks.map((i) => (
        <text key={i} x={x(i)} y={H - 10} textAnchor="middle" className="axis">
          {dayLabel(points[i].date)}
        </text>
      ))}
      <text x={PAD} y={PAD - 12} className="axis">
        {money(max)}
      </text>
    </svg>
  );
}

function BarsChart({ points }) {
  const W = 660;
  const H = 210;
  const PAD = 34;
  const max = Math.max(1, ...points.map((p) => Number(p.reservations)));
  const slot = (W - PAD * 2) / Math.max(points.length, 1);
  const w = Math.max(2, slot * 0.6);
  const ticks = [0, Math.floor(points.length / 2), points.length - 1].filter(
    (v, i, a) => a.indexOf(v) === i && points[v],
  );

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="chart"
      role="img"
      aria-label="Réservations par jour"
    >
      {[0.5, 1].map((r) => (
        <line
          key={r}
          x1={PAD}
          x2={W - PAD}
          y1={H - PAD - r * (H - PAD * 2)}
          y2={H - PAD - r * (H - PAD * 2)}
          className="grid"
        />
      ))}
      {points.map((p, i) => {
        const h = (Number(p.reservations) / max) * (H - PAD * 2);
        return (
          <rect
            key={p.date}
            x={PAD + i * slot + (slot - w) / 2}
            y={H - PAD - h}
            width={w}
            height={h}
            rx="3"
            className="bar"
          >
            <title>{`${p.date} : ${p.reservations} réservation(s)`}</title>
          </rect>
        );
      })}
      {ticks.map((i) => (
        <text
          key={i}
          x={PAD + i * slot + slot / 2}
          y={H - 10}
          textAnchor="middle"
          className="axis"
        >
          {dayLabel(points[i].date)}
        </text>
      ))}
      <text x={PAD} y={PAD - 12} className="axis">
        {max}
      </text>
    </svg>
  );
}

function Donut({ slices }) {
  const total = slices.reduce((s, x) => s + Number(x.value), 0);
  const R = 62;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="donut-wrap">
      <svg
        viewBox="0 0 160 160"
        className="donut"
        role="img"
        aria-label="Répartition des réservations par type"
      >
        <circle
          cx="80"
          cy="80"
          r={R}
          className="donut-track"
          fill="none"
          strokeWidth="22"
        />
        {slices.map((s) => {
          const frac = total ? Number(s.value) / total : 0;
          const el = (
            <circle
              key={s.key}
              cx="80"
              cy="80"
              r={R}
              fill="none"
              strokeWidth="22"
              stroke={s.color}
              strokeDasharray={`${(frac * C).toFixed(1)} ${C.toFixed(1)}`}
              strokeDashoffset={(-acc * C).toFixed(1)}
              transform="rotate(-90 80 80)"
            >
              <title>{`${s.label} : ${s.value} réservation(s)`}</title>
            </circle>
          );
          acc += frac;
          return el;
        })}
        <text x="80" y="78" textAnchor="middle" className="donut-total">
          {total}
        </text>
        <text x="80" y="96" textAnchor="middle" className="axis">
          résa.
        </text>
      </svg>
      <ul className="legend">
        {slices.map((s) => (
          <li key={s.key}>
            <span className="legend-dot" style={{ background: s.color }} />
            <span className="grow">{s.label}</span>
            <b>{s.value}</b>
            <small>{money(s.revenue)}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Barres horizontales en CSS (moyens de paiement, top services). */
function HBars({ rows, color }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.value)));
  if (rows.length === 0) return <p className="muted">Pas encore de données.</p>;
  return (
    <ul className="hbars">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="hbars-head">
            <span>{r.label}</span>
            <b>{r.display}</b>
          </div>
          <div className="hbars-track">
            <div
              className="hbars-fill"
              style={{
                width: `${(Number(r.value) / max) * 100}%`,
                background: color,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Dashboard({ api, notify, onOpenService }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updated, setUpdated] = useState(null);

  const load = async (d) => {
    setLoading(true);
    try {
      const r = await api("admin", "getDashboardStats", { days: d });
      setData(r.dashboard);
      setUpdated(new Date());
    } catch (e) {
      notify(e.message, true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(days);
  }, [days]);

  if (!data) {
    return (
      <>
        <div className="kpi-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card kpi skeleton" />
          ))}
        </div>
        <div className="charts">
          <div className="card skeleton tall" />
          <div className="card skeleton tall" />
        </div>
      </>
    );
  }

  const k = data.kpis;
  const daily = list(data.daily);
  const byType = list(data.byType);
  const byMethod = list(data.byMethod);
  const top = list(data.topServices);
  const low = list(data.lowAvailability);
  const recent = list(data.recent);

  const cards = [
    {
      icon: "💰",
      label: "Revenu de la période",
      value: money(k.revenue),
      extra: <Delta current={k.revenue} previous={k.previousRevenue} />,
    },
    {
      icon: "🧾",
      label: "Réservations",
      value: k.reservationsInPeriod,
      extra: (
        <Delta
          current={k.reservationsInPeriod}
          previous={k.previousReservations}
        />
      ),
    },
    {
      icon: "👥",
      label: "Utilisateurs",
      value: k.totalUsers,
      extra: <span className="muted small">+{k.newUsers} sur la période</span>,
    },
    {
      icon: "📊",
      label: "Taux d'occupation",
      value: `${k.occupancyRate} %`,
      extra: <span className="muted small">places réservées à venir</span>,
    },
    {
      icon: "🛒",
      label: "Panier moyen",
      value: money(k.averageBasket),
      extra: (
        <span className="muted small">
          {k.confirmedReservations} confirmée(s)
        </span>
      ),
    },
    {
      icon: "⏳",
      label: "En attente de paiement",
      value: k.pendingReservations,
      extra: <span className="muted small">expirent après 2 min</span>,
    },
    {
      icon: "↩️",
      label: "Remboursements",
      value: money(k.refundedAmount),
      extra: <span className="muted small">sur la période</span>,
    },
    {
      icon: "🗂",
      label: "Services",
      value: k.totalServices,
      extra: (
        <span className="muted small">
          {k.cancelledReservations} annulée(s) au total
        </span>
      ),
    },
  ];

  const hasActivity = Number(k.totalReservations) > 0;

  return (
    <>
      <div className="toolbar dashboard-tools">
        <div
          className="segmented"
          role="group"
          aria-label="Période du tableau de bord"
        >
          {PERIODS.map((d) => (
            <button
              key={d}
              className={days === d ? "active" : ""}
              onClick={() => setDays(d)}
              aria-pressed={days === d}
            >
              {d} jours
            </button>
          ))}
        </div>
        <div className="grow" />
        <span className="muted small">
          {updated
            ? `Mis à jour à ${updated.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
            : ""}
        </span>
        <button
          onClick={() => load(days)}
          disabled={loading}
          aria-label="Actualiser le tableau de bord"
        >
          ⟳ Actualiser
        </button>
      </div>

      {!hasActivity && (
        <p className="muted">
          Aucune réservation enregistrée pour l'instant : les indicateurs
          restent à zéro.
        </p>
      )}

      <div className={`kpi-grid ${loading ? "loading" : ""}`}>
        {cards.map((c) => (
          <div className="card kpi" key={c.label}>
            <span className="kpi-icon" aria-hidden="true">
              {c.icon}
            </span>
            <span className="kpi-label">{c.label}</span>
            <strong className="kpi-value">{c.value}</strong>
            {c.extra}
          </div>
        ))}
      </div>

      <div className="charts">
        <section className="card chart-card">
          <h3>Revenu par jour</h3>
          <p className="muted small">
            Paiements encaissés (les remboursements sont exclus).
          </p>
          <RevenueChart points={daily} />
        </section>
        <section className="card chart-card">
          <h3>Réservations par jour</h3>
          <p className="muted small">
            Toutes réservations créées sur la période.
          </p>
          <BarsChart points={daily} />
        </section>
      </div>

      <div className="charts charts-3">
        <section className="card chart-card">
          <h3>Répartition par type</h3>
          <Donut
            slices={byType.map((t) => ({
              key: t.type,
              label: TYPE_LABELS[t.type] || t.type,
              value: t.reservations,
              revenue: t.revenue,
              color: TYPE_COLORS[t.type],
            }))}
          />
        </section>
        <section className="card chart-card">
          <h3>Moyens de paiement</h3>
          <HBars
            color="var(--blue)"
            rows={byMethod.map((m) => ({
              key: m.method,
              label: METHOD_LABELS[m.method] || m.method,
              value: m.amount,
              display: `${money(m.amount)} · ${m.payments}`,
            }))}
          />
        </section>
        <section className="card chart-card">
          <h3>Top 5 des services</h3>
          <HBars
            color="var(--amber)"
            rows={top.map((s) => ({
              key: s.serviceId,
              label: s.name,
              value: s.reservations,
              display: `${s.reservations} · ${money(s.revenue)}`,
            }))}
          />
        </section>
      </div>

      <section className="card">
        <div className="row-between">
          <h3>Alertes : dates presque complètes</h3>
          <span className="muted small">
            ≤ 20 % de places restantes, 30 prochains jours
          </span>
        </div>
        {low.length === 0 ? (
          <p className="muted">Aucune date en tension : tout va bien.</p>
        ) : (
          <div className="table">
            <table>
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Date</th>
                  <th>Places restantes</th>
                  <th>Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {low.map((a) => (
                  <tr key={`${a.serviceId}-${a.date}`}>
                    <td>{a.serviceName}</td>
                    <td>{a.date}</td>
                    <td>
                      <span className="status">
                        {a.availableSlots} / {a.totalSlots}
                      </span>
                    </td>
                    <td>{a.totalSlots}</td>
                    <td>
                      <button onClick={() => onOpenService(a.serviceId)}>
                        Gérer les dates
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h3>Dernières réservations</h3>
        {recent.length === 0 ? (
          <p className="muted">Aucune réservation récente.</p>
        ) : (
          <ul className="recent-list">
            {recent.map((r) => (
              <li key={r.id}>
                <span className="grow">
                  <b>{r.serviceName}</b>
                  <small className="muted">
                    #{r.id} · {r.date} · {r.quantity} place(s) ·{" "}
                    {money(r.totalPrice)}
                  </small>
                </span>
                <span className={`status ${r.status}`}>
                  {STATUS_LABEL[r.status] || r.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
