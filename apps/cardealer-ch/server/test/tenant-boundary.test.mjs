/**
 * Mandantengrenze als Quelltext-Test, nicht nur als Konvention — analog zu
 * `test/payload-privacy.test.mjs` im US-Repo (SCHWEIZ-SAAS.md §3: "es braucht
 * genau einen Test, der über den Quelltext läuft und behauptet: es gibt
 * keinen Datenbankzugriff ausserhalb von withTenant()").
 *
 * Prüft: kein Modul unter src/ (Routen, Services, Plugins, ...) importiert
 * `getPool` direkt aus @tiff/core-db. Jeder Datenbankzugriff muss über
 * withTenant()/withoutTenant() laufen, die ihrerseits getPool() kapseln —
 * der Scan deckt bewusst den ganzen Baum ab, nicht nur src/routes/, seit
 * services/auth.js dazukam: die Grenze gilt für jede Schicht, die die DB
 * anfasst, nicht nur für die HTTP-Handler selbst.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.join(here, '..', 'src')

function collectJsFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return collectJsFiles(full)
    return full.endsWith('.js') ? [full] : []
  })
}

test('no module under src/ imports getPool directly — every DB access goes through withTenant()', () => {
  const offenders = []
  for (const file of collectJsFiles(srcDir)) {
    const src = readFileSync(file, 'utf8')
    if (/\bgetPool\b/.test(src)) offenders.push(file)
  }
  assert.deepEqual(offenders, [])
})
