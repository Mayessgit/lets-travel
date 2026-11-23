// Mode sombre : choix mémorisé, sinon préférence du système.
const KEY = 'theme';

export function initialTheme() {
  const saved = localStorage.getItem(KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Applique le thème au document (variables CSS de [data-theme]) et le mémorise. */
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(KEY, theme);
}
