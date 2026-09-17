import { formatMoney } from '@tiff/core-billing'
import { t } from './i18n/index.js'

/**
 * Phase-0-Platzhalter: zeigt, dass core-billing (Geld in Rappen, CHF-Format)
 * und die de-CH-Übersetzungsschicht aus dem Browser heraus funktionieren.
 * Login, Fahrzeugliste und die übrigen Bildschirme aus ANFORDERUNGEN.md §9
 * Phase 1 sind der nächste Schritt, kein Teil dieses Grundgerüsts.
 */
export default function App() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <h1 className="text-2xl font-bold text-gray-900">{t('app.name')}</h1>
      <p className="mt-2 text-gray-600">
        {t('dashboard.emptyBody')}
      </p>
      <p className="mt-4 text-sm text-gray-500">
        Beispiel Geldformat ({t('vehicle.fields.askingPrice')}): {formatMoney(1_250_000)}
      </p>
    </div>
  )
}
