/**
 * makeKey/modelKey über AutoScout24s eigene Nachschlagewerke finden, statt
 * eine selbstgebaute Marken-Tabelle zu raten (siehe mapping.js für die
 * Begründung, warum Raten hier die falsche Antwort ist).
 *
 * ANNAHME, NICHT BESTÄTIGT: das genaue Feldformat von `GET /public/v1/makes`
 * und `.../models` kennt diese Session nicht aus einer Live-Antwort — nur
 * aus der Beschreibung in AUTOSCOUT24-API.md §2 ("Marke und Modell müssen
 * als AS24-Schlüssel übergeben werden, z.B. audi, a6"). Angenommen wird ein
 * `{ key, name }`-Paar pro Eintrag, das bei anderen REST-Nachschlagewerken
 * dieser Art üblich ist. **Gegen die echte Preproduktion verifizieren,
 * sobald Zugangsdaten bestehen** (AUTOSCOUT24-API.md §5/§6) — bis dahin ist
 * das eine Annahme, keine Messung.
 */
export class MakeNotFoundError extends Error {
  constructor(name) {
    super(`Marke '${name}' nicht in AutoScout24s Markenliste gefunden — von Hand nachschlagen und makeKey direkt angeben.`)
    this.name_ = name
  }
}

export class ModelNotFoundError extends Error {
  constructor(name, makeKey) {
    super(`Modell '${name}' nicht in der Modell-Liste von '${makeKey}' gefunden — von Hand nachschlagen und modelKey direkt angeben.`)
  }
}

function normalize(text) {
  return String(text ?? '')
    .trim()
    .toLowerCase()
}

/** @returns {string|null} den key eines Eintrags mit passendem `name`, case-insensitiv, oder null. */
function findKeyByName(entries, name) {
  const target = normalize(name)
  const match = entries.find((entry) => normalize(entry.name ?? entry.label) === target)
  return match?.key ?? null
}

export async function resolveMakeKey(client, credentials, makeName) {
  const makes = await client.listMakes(credentials)
  const key = findKeyByName(makes, makeName)
  if (!key) throw new MakeNotFoundError(makeName)
  return key
}

export async function resolveModelKey(client, credentials, makeKey, modelName) {
  const models = await client.listModels(credentials, makeKey)
  const key = findKeyByName(models, modelName)
  if (!key) throw new ModelNotFoundError(modelName, makeKey)
  return key
}

/** Beides zusammen — der übliche Weg, aus einem Fahrzeug (freies make/model) die AS24-Schlüssel zu holen. */
export async function resolveMakeAndModelKeys(client, credentials, { make, model }) {
  const makeKey = await resolveMakeKey(client, credentials, make)
  const modelKey = await resolveModelKey(client, credentials, makeKey, model)
  return { makeKey, modelKey }
}
