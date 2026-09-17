/**
 * Fahrzeuge — das autohandelsspezifische Herzstück von apps/cardealer-ch.
 *
 * Bewusst NICHT aus Tiff-Cardealer-Manager (US) kopiert: dort speichert
 * `vehicles.miles` Meilen, `plate` ist ein Alaska-Kennzeichen fürs DMV-Formular
 * V6, `title_status`/`warranty_kind`/`odometer_status` sind US-Rechtsbegriffe
 * (FTC Buyers Guide, 16 CFR 455). Für die Schweiz ist das Feldset neu entworfen,
 * nach SCHWEIZ-SAAS.md §4.5 und AUTOSCOUT24-API.md §3 (siehe ANFORDERUNGEN.md §5).
 */
export const shorthands = undefined

export async function up(pgm) {
  pgm.createTable('vehicles', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'CASCADE' },

    vin: { type: 'text' }, // 17 Zeichen, inkl. Prüfziffer — bleibt wie im US-Repo
    // Stammnummer, als Text: führende Nullen und Punkte gehören dazu.
    // Format lt. AutoScout24-API: \d{3}\.\d{3}\.\d{3}(\.\d{3})?
    serial_number: { type: 'text' },
    // Typenscheinnummer (Typengenehmigung), Format lt. AutoScout24-API: ^\w{6}$
    certification_number: { type: 'text' },

    make: { type: 'text' },
    model: { type: 'text' },
    trim: { type: 'text' },
    // Modelljahr UND Erstzulassungsdatum sind in der Schweiz zwei verschiedene
    // Fakten (ein Wagen von 2019 kann 2020 erstzugelassen sein) — nicht wie im
    // US-Schema in einer Spalte `year` vermischen.
    model_year: { type: 'integer' },
    first_registration_date: { type: 'date' },

    body_type: { type: 'text' }, // AS24-Enum: saloon/estate/suv/small-car/coupe/cabriolet/minivan/pickup/van/bus/other
    vehicle_category: { type: 'text' }, // AS24: car/utility/motorcycle/truck/camper/trailer
    condition_type: { type: 'text' }, // AS24: new/used/demonstration/oldtimer/pre-registered
    fuel_type: { type: 'text' },
    transmission_type: { type: 'text' }, // automatic/automatic-stepless/semi-automatic/manual
    drive_type: { type: 'text' }, // rear/front/all
    body_color: { type: 'text' },
    body_color_text: { type: 'text' },
    interior_color: { type: 'text' },
    interior_color_text: { type: 'text' },
    doors: { type: 'smallint' },
    seats: { type: 'smallint' },

    // Leistung in kW primär (CH-üblich), PS wird bei Bedarf abgeleitet, nicht gespeichert.
    power_kw: { type: 'integer' },
    displacement_ccm: { type: 'integer' },
    cylinders: { type: 'smallint' },

    // Kilometerstand direkt in km — keine Umrechnung wie im US-Repo (dort Meilen).
    mileage_km: { type: 'integer' },
    owners_count: { type: 'smallint' },

    // MFK: letzte Prüfung + gültig bis. "ab MFK" ist eine Vertragszusage, kein
    // Beschreibungstext (SCHWEIZ-SAAS.md §4.5) — deshalb ein eigenes Feld statt
    // freier Bemerkung.
    last_inspection_date: { type: 'date' },
    inspection_valid_until: { type: 'date' },
    sold_with_inspection: { type: 'boolean', notNull: true, default: false },

    // Energieetikette, aus Stammnummer/Typenscheinnummer abrufbar (AS24
    // vehicle-energy-efficiency/detect) statt von Hand erfasst.
    energy_label: { type: 'text' }, // a..g
    co2_emission: { type: 'numeric(6,1)' },
    consumption_combined: { type: 'numeric(5,2)' },

    warranty_type: { type: 'text' }, // AS24: from-date/from-delivery/from-first-registration/none

    // Geld in Rappen, nie REAL — SCHWEIZ-SAAS.md §4.1.
    purchase_price_rappen: { type: 'bigint' },
    asking_price_rappen: { type: 'bigint' },
    sold_price_rappen: { type: 'bigint' },

    // MWST pro Fahrzeug, nicht pro Mandant — SCHWEIZ-SAAS.md §4.3, ANFORDERUNGEN.md §6.
    vat_scheme: {
      type: 'text',
      notNull: true,
      default: 'notional_input_tax',
      check: "vat_scheme IN ('standard', 'notional_input_tax', 'margin')",
    },
    purchase_from: {
      type: 'text',
      check: "purchase_from IN ('private', 'dealer', 'auction', 'trade_in')",
    },
    purchase_vat_rappen: { type: 'bigint', notNull: true, default: 0 },
    // Berechnet und gespeichert statt nur zur Anzeige berechnet — dient als
    // Beweislage gegenüber der ESTV (MWSTG Art. 28a).
    notional_input_tax_rappen: { type: 'bigint', notNull: true, default: 0 },

    status: {
      type: 'text',
      notNull: true,
      default: 'in_stock',
      check: "status IN ('in_stock', 'reserved', 'sold', 'written_off')",
    },
    purchased_at: { type: 'date' },
    sold_at: { type: 'date' },
    seller_party_id: { type: 'uuid', references: 'parties' },
    buyer_party_id: { type: 'uuid', references: 'parties' },

    // AutoScout24-Anbindung (Phase 3, ANFORDERUNGEN.md §9): externalId ist die
    // eigene Fahrzeug-ID, darüber findet das Inserat sich selbst wieder statt
    // ein zweites zu erzeugen (AUTOSCOUT24-API.md §2).
    autoscout24_listing_id: { type: 'text' },
    autoscout24_synced_at: { type: 'timestamptz' },

    notes: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.createIndex('vehicles', 'tenant_id')
  pgm.createIndex('vehicles', 'vin')

  pgm.sql('ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY')
  pgm.sql(`
    CREATE POLICY tenant_isolation ON vehicles
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
  `)

  pgm.addConstraint('documents', 'documents_vehicle_fk', {
    foreignKeys: {
      columns: 'vehicle_id',
      references: 'vehicles(id)',
    },
  })

  // Whitelist der Felder, die je an eine externe Stelle (AutoScout24, eigene
  // Website) gehen dürfen — Muster aus lib/sync/payload.mjs im US-Repo
  // (assertNoFinancialData), hier als Sicht statt als Programmfunktion, damit
  // ein vergessenes Feld in einer neuen Spalte nicht automatisch mitfliesst.
  // purchase_price_rappen, sold_price_rappen, seller/buyer_party_id und die
  // MWST-Interna sind hier bewusst NICHT aufgeführt (AUTOSCOUT24-API.md §3,
  // "Was NIE hinaufgeht").
  pgm.sql(`
    CREATE VIEW public_vehicle_listing AS
    SELECT
      id, tenant_id, vin, serial_number, certification_number,
      make, model, trim, model_year, first_registration_date,
      body_type, vehicle_category, condition_type, fuel_type,
      transmission_type, drive_type, body_color, body_color_text,
      interior_color, interior_color_text, doors, seats,
      power_kw, displacement_ccm, cylinders, mileage_km, owners_count,
      last_inspection_date, inspection_valid_until, sold_with_inspection,
      energy_label, co2_emission, consumption_combined, warranty_type,
      asking_price_rappen, status
    FROM vehicles
  `)
  pgm.sql('ALTER VIEW public_vehicle_listing SET (security_invoker = true)')
}

export async function down(pgm) {
  pgm.sql('DROP VIEW IF EXISTS public_vehicle_listing')
  pgm.dropTable('vehicles')
}
