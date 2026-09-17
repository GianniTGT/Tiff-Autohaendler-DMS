import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTranslator } from '../src/i18n.js'

const dict = { nav: { dashboard: 'Übersicht' }, greeting: 'Hallo {name}' }
const t = createTranslator(dict)

test('resolves a dotted key path', () => {
  assert.equal(t('nav.dashboard'), 'Übersicht')
})

test('interpolates placeholders', () => {
  assert.equal(t('greeting', { name: 'Sabit' }), 'Hallo Sabit')
})

test('falls back to the key path itself when missing, never to another language', () => {
  assert.equal(t('nav.missing'), 'nav.missing')
})
