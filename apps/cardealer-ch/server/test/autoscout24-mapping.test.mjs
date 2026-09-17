/**
 * Reiner Unit-Test, kein Netzwerk, keine DB — siehe
 * src/integrations/autoscout24/mapping.js.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapVehicleToAutoScout24Listing, MissingAutoScout24FieldsError, NEVER_UPLOADED_FIELDS } from '../src/integrations/autoscout24/mapping.js'

const FULL_VEHICLE = {
  id: 'vehicle-123',
  vin: 'WVWZZZ1JZXW000123',
  serialNumber: '123.456.789',
  certificationNumber: 'AB123C',
  make: 'Volkswagen',
  model: 'Golf',
  trim: 'GTI',
  vehicleCategory: 'car',
  conditionType: 'used',
  bodyType: 'small-car',
  bodyColor: 'white',
  bodyColorText: 'Pure White',
  interiorColor: 'black',
  interiorColorText: 'Alcantara',
  transmissionType: 'manual',
  driveType: 'front',
  fuelType: 'petrol',
  doors: 5,
  seats: 5,
  powerKw: 180,
  displacementCcm: 1984,
  mileageKm: 42000,
  firstRegistrationDate: '2020-06-15',
  energyLabel: 'C',
  co2Emission: '145.0',
  consumptionCombined: '6.40',
  warrantyType: 'from-delivery',
  inspectionValidUntil: '2027-06-15',
  lastInspectionDate: '2025-06-15',
  askingPriceRappen: 2_400_000,
  // Diese Felder dürfen nie im Payload landen:
  purchasePriceRappen: 1_800_000,
  soldPriceRappen: null,
  purchaseVatRappen: 12_345,
  notionalInputTaxRappen: 67_890,
  sellerPartyId: 'seller-party-id',
  buyerPartyId: 'buyer-party-id',
  vatScheme: 'notional_input_tax',
  purchaseFrom: 'private',
}

test('mapVehicleToAutoScout24Listing baut ein vollständiges, korrektes Inserat', () => {
  const payload = mapVehicleToAutoScout24Listing(FULL_VEHICLE, { makeKey: 'volkswagen', modelKey: 'golf' })

  assert.equal(payload.externalId, 'vehicle-123')
  assert.equal(payload.makeKey, 'volkswagen')
  assert.equal(payload.modelKey, 'golf')
  assert.equal(payload.vehicleIdentificationNumber, 'WVWZZZ1JZXW000123')
  assert.equal(payload.mileage, 42000)
  assert.equal(payload.kiloWatts, 180)
  assert.equal(payload.cubicCapacity, 1984)
  assert.equal(payload.firstRegistrationDate, '2020-06-15')
  assert.equal(payload.firstRegistrationYear, 2020)
  assert.equal(payload.inspected, true)
  // askingPriceRappen 2'400'000 -> CHF 24'000
  assert.equal(payload.price, 24000)
})

test('mapVehicleToAutoScout24Listing verlangt makeKey/modelKey statt zu raten', () => {
  assert.throws(
    () => mapVehicleToAutoScout24Listing(FULL_VEHICLE, {}),
    (err) => err instanceof MissingAutoScout24FieldsError && err.missingFields.includes('makeKey') && err.missingFields.includes('modelKey'),
  )
})

test('mapVehicleToAutoScout24Listing nennt alle fehlenden Pflichtfelder auf einmal', () => {
  const bare = { id: 'v1' }
  assert.throws(
    () => mapVehicleToAutoScout24Listing(bare, {}),
    (err) => {
      assert.ok(err instanceof MissingAutoScout24FieldsError)
      for (const field of ['vehicleCategory', 'bodyColor', 'bodyType', 'conditionType', 'firstRegistrationDate', 'askingPriceRappen', 'warrantyType']) {
        assert.ok(err.missingFields.includes(field), `erwartete ${field} in den fehlenden Feldern`)
      }
      return true
    },
  )
})

test('kein Einkaufspreis, keine Käufer-/Verkäuferdaten und keine MWST-Interna im Payload — nie', () => {
  const payload = mapVehicleToAutoScout24Listing(FULL_VEHICLE, { makeKey: 'volkswagen', modelKey: 'golf' })
  const serialized = JSON.stringify(payload)

  for (const field of NEVER_UPLOADED_FIELDS) {
    assert.ok(!(field in payload), `${field} darf kein Schlüssel im Payload sein`)
  }
  // Auch als Wert nicht — falls ein Feld unter anderem Namen durchgereicht würde.
  assert.ok(!serialized.includes('1800000'), 'Einkaufspreis darf nirgends im Payload stehen')
  assert.ok(!serialized.includes('seller-party-id'))
  assert.ok(!serialized.includes('buyer-party-id'))
})
