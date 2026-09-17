import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mod10CheckDigit, buildQrrReference } from '../src/qr-invoice.js'

// Referenzbeispiel aus den SIX Implementation Guidelines für die QR-Rechnung:
// "21 00000 00003 13947 14300 09017" — die letzte Ziffer ist die Prüfziffer
// über die ersten 26.
test('mod10CheckDigit matches the official SIX QRR example', () => {
  assert.equal(mod10CheckDigit('21000000000313947143000901'.slice(0, 26)), 7)
})

test('buildQrrReference reproduces the full official SIX example reference', () => {
  const reference = buildQrrReference('21000000000313947143000901')
  assert.equal(reference, '210000000003139471430009017')
})

test('buildQrrReference pads a short id to 26 digits and appends its own check digit', () => {
  const reference = buildQrrReference('313947143000901')
  assert.equal(reference.length, 27)
  const body = reference.slice(0, 26)
  const checkDigit = reference.slice(26)
  assert.equal(body, '00000000000313947143000901')
  assert.equal(Number(checkDigit), mod10CheckDigit(body))
})

test('buildQrrReference strips non-digit characters first', () => {
  const withDashes = buildQrrReference('31-39-47-14-30-00-90-1')
  const plain = buildQrrReference('313947143000901')
  assert.equal(withDashes, plain)
})

test('buildQrrReference throws on empty input', () => {
  assert.throws(() => buildQrrReference(''))
  assert.throws(() => buildQrrReference('abc'))
})
