import pg from 'pg'

const { Pool } = pg

let pool

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Die Anwendung verbindet sich als Rolle OHNE BYPASSRLS.
      // Mandantentrennung läuft ausschliesslich über RLS + app.tenant_id,
      // siehe SCHWEIZ-SAAS.md §3.
    })
  }
  return pool
}

/**
 * Jede Datenbankanfrage läuft durch diese Funktion. Sie setzt app.tenant_id
 * innerhalb der Transaktion (SET LOCAL, gilt nur für diese Transaktion) und
 * stellt so sicher, dass RLS-Policies pro Mandant greifen.
 *
 * Es darf keinen Datenbankzugriff ausserhalb von withTenant() geben — dafür
 * braucht es einen Boundary-Test (siehe apps/cardealer-ch/server/test).
 */
export async function withTenant(tenantId, fn) {
  if (!tenantId) {
    throw new Error('withTenant() ohne tenantId aufgerufen')
  }
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId])
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * Für Vorgänge ohne Mandantenbezug (Login, Ersteinrichtung, Passwort-Reset) —
 * bewusst ungeschützt, analog zu den acht ungeschützten IPC-Kanälen in
 * Tiff-Cardealer-Manager. Jede Verwendung braucht eine eigene Begründung.
 */
export async function withoutTenant(fn) {
  const client = await getPool().connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}
