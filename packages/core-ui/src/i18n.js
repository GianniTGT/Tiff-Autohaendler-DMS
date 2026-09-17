/**
 * Übersetzungs-Lookup — vereinfacht gegenüber `src/i18n/index.js` im US-Repo
 * (Tiff-Cardealer-Manager): dort gab es zwei Wörterbücher (`en`, `de`) mit
 * Schlüssel-für-Schlüssel-Rückfall auf Englisch, weil die Sprache vom
 * US/CH-Regionsfeld abhing. Dieses Produkt kennt nur Deutsch (ANFORDERUNGEN.md
 * §1) — kein Umschalter, kein Fallback nötig. Ein fehlender Schlüssel zeigt
 * den Schlüsselpfad selbst, statt eine falsche Sprache zu zeigen.
 */

function lookup(dict, path) {
  return path.split('.').reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), dict)
}

function interpolate(text, vars) {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match))
}

export function createTranslator(dictionary) {
  return function t(path, vars) {
    const value = lookup(dictionary, path)
    if (typeof value !== 'string') return path
    return interpolate(value, vars)
  }
}
