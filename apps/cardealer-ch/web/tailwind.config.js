/**
 * Farben, Schriften, Radius — übernommen aus Tiff-Cardealer-Manager
 * (tailwind.config.js + lib/palette.js), damit beide Produkte derselben
 * Marke (Tiff Software Solutions) gleich aussehen. Die Rahmenfarbe ist die
 * des Herstellers, nicht die des Betriebs: dasselbe Produkt läuft für den
 * nächsten Betrieb, dessen eigenes Logo und Name kommen aus dem Betriebsprofil.
 *
 * Kontraste sind gemessen (Manager-Repo): `brand` auf Weiss 7.09:1, `steel`
 * 5.71, `ink` 17.0. `mist` ist 2.95 — nur für Hinweise, nie für Lesetext.
 * `gold` ist Dekoration (2.43:1), nie für Text.
 */
const BRAND = '#16653C'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: BRAND,
          dark: '#0F4A2C',
          deep: '#08301C',
          mid: '#3C8C64',
          soft: '#569A76',
          pale: '#8FBFA6',
          wash: '#E6F0EA',
          gold: '#C9A053',
          goldInk: '#AE8638',
        },
        ink: '#1C1C1E',
        canvas: '#F3F6F4',
        tint: { DEFAULT: '#EDF3EF', faint: '#FAFCFA' },
        line: '#E2E8E3',
        'line-strong': '#C5D0C8',
        'on-brand': { DEFAULT: '#D8E7DF', dim: '#CBDCD2', pure: '#FFFFFF' },
        steel: '#5B6A61',
        mist: '#8B9A90',
        // Geld und Gefahr, nicht Marke.
        profit: { DEFAULT: '#1D9E6F', bg: '#E4F5EE' },
        warn: { DEFAULT: '#C77E1D', bg: '#FBF1DF' },
        danger: { DEFAULT: '#C4453B', bg: '#FBE9E7' },
      },
      fontFamily: {
        display: ['"Barlow Condensed"', '"Bahnschrift SemiCondensed"', '"Arial Narrow"', 'sans-serif'],
        body: ['Barlow', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', '"SF Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: { tiff: '10px' },
    },
  },
  plugins: [],
}
