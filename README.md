# Tiff Autohändler DMS

Dealer-Management-System für Schweizer Occasionshändler — nur Schweiz, nur
Deutsch. Kein US-Markt, kein Sprachumschalter, kein Craigslist.

**Warum dieses Repo existiert und wie es zu `Tiff-Cardealer-Manager` steht:
siehe [`ANFORDERUNGEN.md`](./ANFORDERUNGEN.md).** Das ist die Grundlage für
jede Entscheidung hier — Scope, was übernommen und was verworfen wird,
Architektur, MWST/QR-Rechnung/Verträge, Roadmap.

## Struktur

```
packages/
  core-db/       Migrationen, withTenant(), Row-Level-Security
  core-auth/     Rollen (inhaber/verkauf/werkstatt/buchhaltung)
  core-billing/  Geld (Rappen), MWST, Wirtschaftlichkeit, QR-Rechnung, camt.054
  core-docs/     PDF-Layout, Kaufvertrag/Ankaufsvertrag-Gerüst
  core-ui/       Übersetzungs-Lookup (nur de-CH)
apps/
  cardealer-ch/
    server/      Node 22 + Fastify
      src/routes         HTTP-Handler
      src/services       DB-Zugriff, ausschliesslich über withTenant()
      src/plugins        Auth/Cookies
      src/integrations   AutoScout24-Client + Objektspeicher — beide mit injizierbarem
                          fetch/Backend, testbar ohne echte Zugangsdaten
    web/         React 18 + Vite + Tailwind
```

## Entwicklung

### Datenbank-Rollen (wichtig, kein optionaler Schritt)

Zwei Postgres-Rollen, nicht eine: `tiff_migrator` besitzt die Tabellen und
baut das Schema, `tiff_app` ist die Rolle, mit der sich die Anwendung
verbindet. **Das ist keine Vorsichtsmassnahme, sondern die einzige Art, wie
Row Level Security überhaupt greift** — ein Tabellenbesitzer ist davon
standardmässig befreit, egal was die Policy sagt (siehe
`packages/core-db/migrations/1700000000004_runtime-role-hardening.js`).
Lokal einmalig einrichten:

```sql
CREATE ROLE tiff_migrator LOGIN PASSWORD '...';
CREATE ROLE tiff_app LOGIN PASSWORD '...';
CREATE DATABASE tiff_autohaendler_dms OWNER tiff_migrator;
GRANT ALL ON SCHEMA public TO tiff_migrator;
-- Jede Mandanten-Tabelle bekommt FORCE ROW LEVEL SECURITY (siehe die
-- Migration unten) — das gilt dann auch für den Besitzer. tiff_migrator
-- braucht also BYPASSRLS, um administrativ arbeiten zu können (z.B. den
-- ersten Mandanten und die erste Person anlegen, siehe
-- packages/core-db/scripts/seed-dev-tenant.mjs). Das muss ein Postgres-Superuser
-- einmalig setzen, keine Migration kann das selbst:
ALTER ROLE tiff_migrator BYPASSRLS;
```

`npm run migrate` verbindet sich als `tiff_migrator` (`MIGRATE_DATABASE_URL`)
und vergibt darin die nötigen Rechte an `tiff_app`; die Anwendung selbst
verbindet sich immer als `tiff_app` (`DATABASE_URL`) und hat **kein**
BYPASSRLS — nur `tiff_migrator` darf mandantenübergreifend arbeiten, und auch
das nur für Aufbau/Administration, nie für die laufende Anwendung.

```bash
npm install
npm test                              # alle Packages, inkl. Integrationstests gegen Postgres
npm run test:boundary                 # Mandantengrenze (Quelltext-Test)
cp .env.example .env                  # MIGRATE_DATABASE_URL und DATABASE_URL setzen
npm run migrate                       # Postgres-Schema aufbauen

# Ersten Mandanten und die erste Person anlegen (kein Self-Service-Onboarding
# vor Phase 3, siehe ANFORDERUNGEN.md §9):
npm run seed:dev-tenant --workspace packages/core-db -- \
  --slug=mein-betrieb --name="Mein Betrieb AG" --email=ich@example.com --password="..."

npm run dev:server                    # Fastify, Port 3000
npm run dev:web                       # Vite, proxied /api auf :3000
```

Anmelden im Browser (`http://localhost:5173`) mit dem oben gewählten Slug,
E-Mail und Passwort.

## Stand

**Phase 1, 2 und 3 nach `ANFORDERUNGEN.md` §9 sind erreicht:** Login,
Fahrzeuge/Kunden erfassen, Rechnung mit MWST und QR-Zahlteil, Zahlungen
(manuell und per `camt.054`), Mahnwesen mit Verzugszins, MWST-Auswertung
effektiv/Saldosteuersatz, Belegarchiv (echter Objektspeicher, nicht mehr nur
ein Hash) und eine AutoScout24-Anbindung (Push-Richtung, Feld-Mapping und
HTTP-Client fertig und getestet, aber nie gegen die echte API gelaufen — dafür
fehlen Zugangsdaten, siehe unten). 143 automatisierte Tests, 98 davon im
Server gegen eine echte PostgreSQL-Instanz inkl. RLS-Mandantentrennung.

Drei echte Fehler kamen unterwegs ans Licht, die eine reine Unit-Test-Suite
ohne echte Datenbank/Bibliotheken nie gefunden hätte:
- ein `node-pg-migrate`-Default mit doppelten Anführungszeichen im SQL
  (verletzte den `status`-Constraint bei jedem impliziten Insert),
- ein Absturz in `swissqrbill`, wenn die Kundenadresse fehlt (Postgres liefert
  `null`, nicht `undefined`),
- Phase 2s Belegarchiv verglich beim erneuten Abruf einen frisch gerenderten
  Hash — das hätte bei jedem künftigen PDF-Layout-Fix jede historische
  Rechnung als "Integritätsfehler" gemeldet. Phase 3s Objektspeicher behebt
  das: ein archiviertes PDF kommt aus dem Speicher, nie aus erneuter Erzeugung.

**Kaufvertrag und Ankaufsvertrag enthalten noch keinen rechtsgültigen
Text** — siehe `LEGAL_REVIEW_STATUS` in `packages/core-docs/src/kaufvertrag.js`,
das muss vor dem ersten echten Vertrag von einem Schweizer Anwalt geprüft
werden. Die MWST-Auswertung ist nach bestem Wissen aus MWSTG Art. 28a/24a
gebaut, aber nicht von einem Treuhänder bestätigt.

**Zwei Dinge sind gebaut, aber nie gegen echte Infrastruktur gelaufen** —
mangels Zugangsdaten, nicht aus Nachlässigkeit: das S3-Objektspeicher-Backend
(nur der lokale Dateisystem-Fallback ist getestet) und AutoScout24s
Marken-/Modell-Nachschlagewerke (das angenommene Antwortformat steht in
`integrations/autoscout24/lookup.js` und muss gegen die echte Preproduktion
verifiziert werden, sobald Zugangsdaten bestehen).

**Noch offen:** eigene Website-Anbindung an `Tiff-Cardealer-Theme-Swiss` (dafür
existiert noch keine Schweizer Website). Offerte, Auftrag, Lieferschein und
Gutschrift existieren als Datenbanktabelle (siehe `documents.type`), sind
aber noch nicht verdrahtet — nur `invoice` und `reminder` sind es.
