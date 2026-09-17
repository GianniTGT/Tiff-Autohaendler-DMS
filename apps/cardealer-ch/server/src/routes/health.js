/**
 * Ungeschützt, bewusst: ein Health-Check hat keinen Mandanten. Analog zu den
 * acht ungeschützten IPC-Kanälen im US-Repo (Login, Ersteinrichtung,
 * Passwort-Wiederherstellung, Absturzprotokoll) — jede Ausnahme von
 * withTenant() braucht eine eigene Begründung, hier: es gibt noch keine
 * Anfrage, der ein Mandant zugeordnet werden könnte.
 */
export async function registerHealthRoutes(app) {
  app.get('/health', async () => ({ ok: true, service: 'tiff-cardealer-ch', version: '0.1.0' }))
}
