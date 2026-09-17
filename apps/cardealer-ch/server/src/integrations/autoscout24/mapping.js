/**
 * Fahrzeug -> AutoScout24-Inserat (SellerListingCreateRequest). Reine
 * Funktion, kein Netzwerk — die Feldzuordnung ist die eigentliche Arbeit
 * hier, nach AUTOSCOUT24-API.md §3/§4 (im US-Repo recherchiert, 15.9.2026,
 * siehe ANFORDERUNGEN.md §5).
 *
 * Was direkt passt, ohne Übersetzung: `body_type`, `vehicle_category`,
 * `condition_type`, `transmission_type`, `drive_type`, `warranty_type` sind
 * seit der Fahrzeug-Migration in Phase 0 absichtlich schon im
 * AS24-Vokabular gespeichert (siehe die Spaltenkommentare dort) — hier wird
 * nur noch durchgereicht, nicht übersetzt.
 *
 * Was NICHT geraten wird: `makeKey`/`modelKey` sind AS24-eigene Schlüssel
 * (`audi`, `a6`), die aus `GET /public/v1/makes` stammen — unser
 * `vehicles.make`/`model` ist Freitext. Eine Zuordnungstabelle von Hand zu
 * bauen hiesse für jede Marke zu raten; das lehnt dieses Projekt an
 * derselben Stelle ab, an der es sonst "ein Anwalt, nicht Claude" sagt
 * (ANFORDERUNGEN.md §7) — hier: "eine Zuordnungsliste, nicht raten".
 * `makeKey`/`modelKey` müssen deshalb explizit mitgegeben werden.
 *
 * `fuelType` ebenso bewusst nicht übersetzt: AUTOSCOUT24-API.md §4 warnt
 * ausdrücklich, dass TCMs `gas` im US-Sprachgebrauch Benzin meint, in
 * Europa aber Gas — eine automatische Übersetzung hätte an genau dieser
 * Stelle schon einmal falsch gelegen. `vehicles.fuel_type` muss also direkt
 * im AS24-Vokabular erfasst werden (petrol/diesel/electric/...).
 */
import { rappenToFrancs } from '@tiff/core-billing'

export class MissingAutoScout24FieldsError extends Error {
  constructor(missingFields) {
    super(`Für ein AutoScout24-Inserat fehlen: ${missingFields.join(', ')}`)
    this.missingFields = missingFields
  }
}

const REQUIRED = Object.freeze([
  'makeKey',
  'modelKey',
  'vehicleCategory',
  'bodyColor',
  'bodyType',
  'conditionType',
  'firstRegistrationDate',
  'askingPriceRappen',
  'warrantyType',
])

function toIsoDate(value) {
  if (!value) return null
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

/**
 * @param {object} vehicle Ergebnis von services/vehicles.js (camelCase)
 * @param {object} keys { makeKey, modelKey } — aus GET /public/v1/makes bzw.
 *   .../models aufgelöst, siehe integrations/autoscout24/client.js
 * @throws {MissingAutoScout24FieldsError}
 */
export function mapVehicleToAutoScout24Listing(vehicle, keys) {
  const merged = {
    makeKey: keys?.makeKey,
    modelKey: keys?.modelKey,
    vehicleCategory: vehicle.vehicleCategory,
    bodyColor: vehicle.bodyColor,
    bodyType: vehicle.bodyType,
    conditionType: vehicle.conditionType,
    firstRegistrationDate: vehicle.firstRegistrationDate,
    askingPriceRappen: vehicle.askingPriceRappen,
    warrantyType: vehicle.warrantyType,
  }
  const missing = REQUIRED.filter((field) => merged[field] == null || merged[field] === '')
  if (missing.length > 0) {
    throw new MissingAutoScout24FieldsError(missing)
  }

  const firstRegistrationDate = toIsoDate(vehicle.firstRegistrationDate)

  // Feld für Feld aufgebaut, nicht per Objekt-Spread — damit auch eine
  // künftig hinzugefügte Fahrzeugspalte (z.B. ein zweiter Kostenwert)
  // niemals automatisch mit hinausgeht. Dieselbe Whitelist-Disziplin wie
  // die public_vehicle_listing-Sicht in der Fahrzeug-Migration.
  const payload = {
    externalId: vehicle.id,
    makeKey: keys.makeKey,
    modelKey: keys.modelKey,
    versionFullName: vehicle.trim || undefined,
    vehicleIdentificationNumber: vehicle.vin || undefined,
    vehicleCategory: vehicle.vehicleCategory,
    conditionType: vehicle.conditionType,
    bodyType: vehicle.bodyType,
    bodyColor: vehicle.bodyColor,
    bodyColorText: vehicle.bodyColorText || undefined,
    interiorColor: vehicle.interiorColor || undefined,
    interiorColorText: vehicle.interiorColorText || undefined,
    transmissionType: vehicle.transmissionType || undefined,
    driveType: vehicle.driveType || undefined,
    fuelType: vehicle.fuelType || undefined,
    doors: vehicle.doors ?? undefined,
    seats: vehicle.seats ?? undefined,
    kiloWatts: vehicle.powerKw ?? undefined,
    cubicCapacity: vehicle.displacementCcm ?? undefined,
    mileage: vehicle.mileageKm ?? undefined,
    firstRegistrationDate,
    firstRegistrationYear: Number(firstRegistrationDate.slice(0, 4)),
    serialNumber: vehicle.serialNumber || undefined,
    certificationNumber: vehicle.certificationNumber || undefined,
    energyLabel: vehicle.energyLabel || undefined,
    co2Emission: vehicle.co2Emission != null ? Number(vehicle.co2Emission) : undefined,
    consumptionCombined: vehicle.consumptionCombined != null ? Number(vehicle.consumptionCombined) : undefined,
    warrantyType: vehicle.warrantyType,
    inspected: Boolean(vehicle.inspectionValidUntil),
    lastInspectionDate: vehicle.lastInspectionDate ? toIsoDate(vehicle.lastInspectionDate) : undefined,
    price: rappenToFrancs(vehicle.askingPriceRappen),
  }

  return payload
}

/**
 * Felder, die laut AUTOSCOUT24-API.md §3 ("Was NIE hinaufgeht") nie in
 * einem AS24-Payload stehen dürfen — für den Whitelist-Test unten, analog
 * zu `assertNoFinancialData()` im US-Repo (`lib/sync/payload.mjs`).
 */
export const NEVER_UPLOADED_FIELDS = Object.freeze([
  'purchasePriceRappen',
  'soldPriceRappen',
  'purchaseVatRappen',
  'notionalInputTaxRappen',
  'sellerPartyId',
  'buyerPartyId',
  'vatScheme',
  'purchaseFrom',
])
