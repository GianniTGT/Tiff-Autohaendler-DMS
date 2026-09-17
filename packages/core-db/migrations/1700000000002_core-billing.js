/**
 * Fakturierung: MWST-Sätze mit Gültigkeitsdatum, Nummernkreise pro Mandant und
 * Jahr, Belege (Offerte -> Auftrag -> Lieferschein -> Rechnung -> Mahnung ->
 * Gutschrift) und Zahlungen.
 *
 * Geld überall als bigint in Rappen — siehe ANFORDERUNGEN.md §4 und §6.
 * REAL/Fliesskomma ist für MWST-pflichtige Beträge mit Rundung ein echter
 * Fehler, kein theoretischer (SCHWEIZ-SAAS.md §4.1).
 */
export const shorthands = undefined

export async function up(pgm) {
  // Sätze ändern sich (zuletzt 7.7/2.5/3.7 -> 8.1/2.6/3.8 per 1.1.2024) und
  // dürfen deshalb nie eine Konstante im Code sein. Eine bereits gestellte
  // Rechnung muss beim erneuten Druck weiterhin ihren damaligen Satz zeigen.
  pgm.createTable('tax_rates', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    code: { type: 'text', notNull: true }, // 'standard' | 'reduced' | 'accommodation'
    rate_percent: { type: 'numeric(6,3)', notNull: true },
    valid_from: { type: 'date', notNull: true },
    valid_to: { type: 'date' },
  })

  pgm.createTable('number_sequences', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'CASCADE' },
    document_type: { type: 'text', notNull: true }, // 'offer' | 'order' | 'delivery_note' | 'invoice' | 'credit_note'
    year: { type: 'integer', notNull: true },
    next_value: { type: 'integer', notNull: true, default: 1 },
  })
  pgm.addConstraint('number_sequences', 'number_sequences_unique', {
    unique: ['tenant_id', 'document_type', 'year'],
  })

  pgm.createTable('documents', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'CASCADE' },
    party_id: { type: 'uuid', references: 'parties' },
    type: {
      type: 'text',
      notNull: true,
      check: "type IN ('offer', 'order', 'delivery_note', 'invoice', 'reminder', 'credit_note')",
    },
    number: { type: 'text', notNull: true }, // aus number_sequences gebildet, z.B. RE-2026-00042
    status: { type: 'text', notNull: true, default: 'draft' },
    issue_date: { type: 'date', notNull: true, default: pgm.func('current_date') },
    due_date: { type: 'date' },
    // Bezug auf das vorangehende Dokument in der Belegkette (Offerte -> Auftrag -> ... )
    predecessor_id: { type: 'uuid', references: 'documents' },
    vehicle_id: { type: 'uuid' }, // FK folgt in der cardealer-ch-Migration (core-db kennt keine Fahrzeuge)
    // Summen in Rappen, aus den Positionen berechnet und hier zur Historie eingefroren.
    subtotal_rappen: { type: 'bigint', notNull: true, default: 0 },
    vat_rappen: { type: 'bigint', notNull: true, default: 0 },
    total_rappen: { type: 'bigint', notNull: true, default: 0 },
    // QR-Rechnung: Referenztyp und Referenz, siehe packages/core-billing/src/qr-invoice.js
    qr_reference_type: { type: 'text' }, // 'QRR' | 'SCOR' | 'NON'
    qr_reference: { type: 'text' },
    pdf_hash: { type: 'text' }, // Hash des unveränderlich archivierten PDF (OR 958f, GeBüV)
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('documents', 'documents_tenant_number_unique', {
    unique: ['tenant_id', 'number'],
  })
  pgm.createIndex('documents', 'tenant_id')

  pgm.createTable('document_lines', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'CASCADE' },
    position: { type: 'integer', notNull: true },
    description: { type: 'text', notNull: true },
    quantity: { type: 'numeric(10,2)', notNull: true, default: 1 },
    unit_price_rappen: { type: 'bigint', notNull: true },
    tax_rate_id: { type: 'uuid', references: 'tax_rates' },
    line_total_rappen: { type: 'bigint', notNull: true },
  })

  pgm.createTable('payments', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'CASCADE' },
    document_id: { type: 'uuid', notNull: true, references: 'documents' },
    amount_rappen: { type: 'bigint', notNull: true },
    paid_at: { type: 'date', notNull: true },
    // camt.054-Import (Phase 2, ANFORDERUNGEN.md §9): die Bank liefert die
    // QR-Referenz zurück, darüber wird die Zahlung automatisch zugeordnet.
    source: { type: 'text', notNull: true, default: 'manual' }, // 'manual' | 'camt054'
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.createIndex('payments', 'tenant_id')

  for (const table of ['documents', 'payments']) {
    pgm.sql(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)
    pgm.sql(`
      CREATE POLICY tenant_isolation ON ${table}
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
    `)
  }
  // document_lines hängt über document_id an einem bereits RLS-geschützten
  // Dokument; eigene RLS zusätzlich, damit ein vergessenes JOIN nie zu einer
  // fremden Zeile führt (Verteidigung in der Tiefe, wie in SCHWEIZ-SAAS.md §3
  // fuer withTenant() begründet).
  pgm.sql('ALTER TABLE document_lines ENABLE ROW LEVEL SECURITY')
  pgm.sql(`
    CREATE POLICY tenant_isolation ON document_lines
      USING (document_id IN (
        SELECT id FROM documents WHERE tenant_id = current_setting('app.tenant_id', true)::uuid
      ))
  `)

  // MWST-Sätze seit 1.1.2024 (SCHWEIZ-SAAS.md §4.2). Die Vorgänger-Sätze
  // (7.7/2.5/3.7, gültig bis 31.12.2023) bewusst nicht vorausgefüllt — sie
  // werden nachgetragen, sobald eine Rechnung aus der Zeit reproduziert werden
  // muss, mit einem Treuhänder gegengeprüft (ANFORDERUNGEN.md §6).
  pgm.sql(`
    INSERT INTO tax_rates (id, code, rate_percent, valid_from, valid_to) VALUES
      (gen_random_uuid(), 'standard', 8.1, '2024-01-01', NULL),
      (gen_random_uuid(), 'reduced', 2.6, '2024-01-01', NULL),
      (gen_random_uuid(), 'accommodation', 3.8, '2024-01-01', NULL)
  `)
}

export async function down(pgm) {
  pgm.dropTable('document_lines')
  pgm.dropTable('payments')
  pgm.dropTable('documents')
  pgm.dropTable('number_sequences')
  pgm.dropTable('tax_rates')
}
