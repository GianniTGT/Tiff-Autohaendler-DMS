import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCamt054 } from '../src/camt054.js'

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02">
  <BkToCstmrDbtCdtNtfctn>
    <Ntfctn>
      <Ntry>
        <Amt Ccy="CHF">1081.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <ValDt><Dt>2026-07-15</Dt></ValDt>
        <NtryDtls>
          <TxDtls>
            <RmtInf>
              <Strd>
                <CdtrRefInf>
                  <Ref>210000000003139471430009017</Ref>
                </CdtrRefInf>
              </Strd>
            </RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="CHF">50.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <ValDt><Dt>2026-07-16</Dt></ValDt>
        <NtryDtls>
          <TxDtls>
            <RmtInf>
              <Ustrd>Vielen Dank</Ustrd>
            </RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="CHF">20.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <ValDt><Dt>2026-07-16</Dt></ValDt>
      </Ntry>
    </Ntfctn>
  </BkToCstmrDbtCdtNtfctn>
</Document>`

test('parseCamt054 extracts amount, currency, date and structured QR reference', () => {
  const entries = parseCamt054(SAMPLE_XML)
  assert.equal(entries.length, 3)

  assert.equal(entries[0].amountRappen, 108_100)
  assert.equal(entries[0].currency, 'CHF')
  assert.equal(entries[0].valueDate, '2026-07-15')
  assert.equal(entries[0].creditDebitIndicator, 'CRDT')
  assert.equal(entries[0].reference, '210000000003139471430009017')
  assert.equal(entries[0].referenceIsStructured, true)
})

test('parseCamt054 falls back to the unstructured message when no QR reference exists', () => {
  const entries = parseCamt054(SAMPLE_XML)
  assert.equal(entries[1].reference, 'Vielen Dank')
  assert.equal(entries[1].referenceIsStructured, false)
})

test('parseCamt054 keeps debit entries but marks them distinctly, with no reference expected', () => {
  const entries = parseCamt054(SAMPLE_XML)
  assert.equal(entries[2].creditDebitIndicator, 'DBIT')
  assert.equal(entries[2].reference, null)
})

test('parseCamt054 rejects input that is not a camt.054 document', () => {
  assert.throws(() => parseCamt054('<Document><Something/></Document>'))
})
