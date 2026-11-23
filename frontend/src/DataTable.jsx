import { useEffect, useMemo, useState } from 'react';

const PAGE_SIZE = 10;

/**
 * Tableau d'administration générique.
 * - `columns` : [{ key, label, render?(row), value?(row) }] — `value` sert au tri et au CSV.
 * - `rows === null` affiche l'état de chargement.
 * - Export CSV UTF-8 avec BOM (accents corrects dans Excel) ; jamais de colonne photo.
 */
export default function DataTable({ columns, rows, empty = 'Aucune donnée.', actions, csvName = 'export' }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  const [page, setPage] = useState(1);

  const valueOf = (row, col) => String((col.value ? col.value(row) : row[col.key]) ?? '');

  const filtered = useMemo(() => {
    const list = rows || [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((row) => columns.some((c) => valueOf(row, c).toLowerCase().includes(q)));
  }, [rows, query, columns]);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return filtered;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = col.value ? col.value(a) : a[col.key];
      const vb = col.value ? col.value(b) : b[col.key];
      const na = Number(va);
      const nb = Number(vb);
      if (va !== '' && vb !== '' && Number.isFinite(na) && Number.isFinite(nb)) return (na - nb) * dir;
      return String(va ?? '').localeCompare(String(vb ?? ''), 'fr') * dir;
    });
  }, [filtered, sort, columns]);

  // Toute nouvelle sélection (recherche, rechargement) revient à la première page.
  useEffect(() => { setPage(1); }, [query, rows]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const slice = sorted.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const toggleSort = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));

  const exportCsv = () => {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [columns.map((c) => cell(c.label)).join(';')];
    for (const row of sorted) lines.push(columns.map((c) => cell(valueOf(row, c))).join(';'));
    const blob = new Blob([`\ufeff${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${csvName}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (rows === null || rows === undefined) {
    return <div className="table"><p className="muted">Chargement…</p></div>;
  }

  return (
    <>
      <div className="toolbar table-tools">
        <input placeholder="Rechercher…" value={query} onChange={(e) => setQuery(e.target.value)}
          aria-label="Rechercher dans le tableau" />
        <div className="grow" />
        <button onClick={exportCsv} disabled={sorted.length === 0}>⬇ Export CSV</button>
      </div>

      <div className="table">
        {sorted.length === 0 ? <p className="muted">{query ? 'Aucun résultat pour cette recherche.' : empty}</p> : (
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button className="th-sort" onClick={() => toggleSort(c.key)}>
                      {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </button>
                  </th>
                ))}
                {actions && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {slice.map((row, i) => (
                <tr key={row.id ?? i}>
                  {columns.map((c) => <td key={c.key}>{c.render ? c.render(row) : row[c.key]}</td>)}
                  {actions && <td className="actions">{actions(row)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {sorted.length > PAGE_SIZE && (
        <div className="pager">
          <button onClick={() => setPage(current - 1)} disabled={current === 1}>← Précédent</button>
          <span className="muted">Page {current} / {pages} · {sorted.length} ligne(s)</span>
          <button onClick={() => setPage(current + 1)} disabled={current === pages}>Suivant →</button>
        </div>
      )}
    </>
  );
}
