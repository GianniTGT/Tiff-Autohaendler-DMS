/**
 * AutoScout24 DMS-API — HTTP-Client. Nach AUTOSCOUT24-API.md §2 (im
 * US-Repo recherchiert, Grundlage: OpenAPI-Spezifikation 1.0.1,
 * <https://developers.autoscout24.ch>).
 *
 * `fetchImpl` ist injizierbar, damit dieser Client ohne echte
 * AutoScout24-Zugangsdaten UND ohne Netzwerkzugriff getestet werden kann —
 * dasselbe Prinzip wie `withTenant()` für die Datenbank: die Schnittstelle
 * nach aussen ist austauschbar, damit ein Test sie ersetzen kann, statt
 * gegen die echte Gegenstelle zu laufen.
 *
 * ZWEI OFFENE FRAGEN, DIE AUTOSCOUT24-API.md §5 SCHON NENNT UND DIE HIER
 * NICHT BEANTWORTET WERDEN (kaufmännisch, nicht technisch):
 *  1. Wie kommt ein Mandant an client_id/client_secret?
 *  2. Was kostet eine VIN-Abfrage? — deshalb ruft dieser Client die
 *     VIN-Auflösung (configurator/eurotax/.../vehicle-identification-number)
 *     bewusst NICHT auf. Stammnummer/Typenscheinnummer sind die
 *     kostenlose Alternative, siehe AUTOSCOUT24-API.md §2.
 */

const PRODUCTION_BASE_URL = 'https://api.autoscout24.ch'
export const PREPROD_BASE_URL = 'https://api.preprod.autoscout24.dev'

export class AutoScout24ApiError extends Error {
  constructor(status, body) {
    super(`AutoScout24-API-Fehler ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`)
    this.status = status
    this.body = body
  }
}

export function createAutoScout24Client({ baseUrl = PRODUCTION_BASE_URL, fetchImpl = fetch } = {}) {
  const tokenCache = new Map() // clientId -> { token, expiresAt }

  async function getToken(clientId, clientSecret) {
    const cached = tokenCache.get(clientId)
    if (cached && Date.now() < cached.expiresAt) return cached.token

    const response = await fetchImpl(`${baseUrl}/public/v1/clients/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        audience: baseUrl,
      }),
    })
    if (!response.ok) {
      throw new AutoScout24ApiError(response.status, await response.text().catch(() => ''))
    }
    const data = await response.json()
    // 60s Sicherheitsabstand vor dem echten Ablauf, damit ein Token nicht
    // mitten in einer Anfrage abläuft.
    const expiresAt = Date.now() + (Number(data.expires_in) - 60) * 1000
    tokenCache.set(clientId, { token: data.access_token, expiresAt })
    return data.access_token
  }

  async function request(method, path, { credentials, body, isForm = false } = {}) {
    const token = await getToken(credentials.clientId, credentials.clientSecret)
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    })
    if (!response.ok) {
      throw new AutoScout24ApiError(response.status, await response.text().catch(() => ''))
    }
    if (response.status === 204) return null
    const text = await response.text()
    return text ? JSON.parse(text) : null
  }

  return {
    getToken,

    createListing: (credentials, sellerId, payload) =>
      request('POST', `/public/v1/sellers/${sellerId}/listings`, { credentials, body: payload }),

    updateListing: (credentials, sellerId, listingId, payload) =>
      request('PUT', `/public/v1/sellers/${sellerId}/listings/${listingId}`, { credentials, body: payload }),

    activateListing: (credentials, sellerId, listingId) =>
      request('POST', `/public/v1/sellers/${sellerId}/listings/${listingId}/activate`, { credentials }),

    deactivateListing: (credentials, sellerId, listingId) =>
      request('POST', `/public/v1/sellers/${sellerId}/listings/${listingId}/deactivate`, { credentials }),

    removeListing: (credentials, sellerId, listingId) =>
      request('POST', `/public/v1/sellers/${sellerId}/listings/${listingId}/remove`, { credentials }),

    findByExternalId: (credentials, sellerId, externalId) =>
      request('GET', `/public/v1/sellers/${sellerId}/listings/external-id/${encodeURIComponent(externalId)}`, {
        credentials,
      }).catch((err) => {
        // 404 heisst "noch kein Inserat", kein Fehler — jeder andere Status bleibt einer.
        if (err instanceof AutoScout24ApiError && err.status === 404) return null
        throw err
      }),

    setEquipment: (credentials, sellerId, listingId, equipment) =>
      request('PUT', `/public/v1/sellers/${sellerId}/listings/${listingId}/equipment`, {
        credentials,
        body: equipment,
      }),

    /**
     * Fotos in zwei Schritten, wie AUTOSCOUT24-API.md §2 beschreibt: erst
     * pro Datei hochladen (liefert einen `key`), dann einmal die Liste der
     * Keys in der gewünschten Reihenfolge setzen.
     */
    uploadImage: (credentials, sellerId, listingId, formData) =>
      request('POST', `/public/v1/sellers/${sellerId}/listings/${listingId}/images/upload`, {
        credentials,
        body: formData,
        isForm: true,
      }),

    setImages: (credentials, sellerId, listingId, keys) =>
      request('PUT', `/public/v1/sellers/${sellerId}/listings/${listingId}/images`, { credentials, body: { keys } }),

    /** Nachschlagewerke, um makeKey/modelKey zu finden — siehe lookup.js. */
    listMakes: (credentials, vehicleCategory = 'car') =>
      request('GET', `/public/v1/makes?vehicleCategory=${encodeURIComponent(vehicleCategory)}`, { credentials }),

    listModels: (credentials, makeKey, vehicleCategory = 'car') =>
      request(
        'GET',
        `/public/v1/makes/key/${encodeURIComponent(makeKey)}/models?vehicleCategory=${encodeURIComponent(vehicleCategory)}`,
        { credentials },
      ),
  }
}
