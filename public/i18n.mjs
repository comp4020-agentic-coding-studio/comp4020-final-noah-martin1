// The interface in the visitor's language, for the page's module scripts.
// The lookup itself is set up in every page's head (I18N_BOOT in
// src/views/layout.ts) so plain scripts like app.js have it too; English is
// the scripts' own text, the key and the fallback, as on the server.
const lookup = window.__t ?? ((s) => s);

export function t(english, vars) {
  let s = lookup(english);
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

export function tn(n, one, many, vars) {
  return t(n === 1 ? one : many, { n, ...vars });
}

// the page's language tag, for dates and numbers (Intl)
export const locale = document.documentElement.lang || "en-AU";
