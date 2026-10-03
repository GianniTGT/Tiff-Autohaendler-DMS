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

npm run dev:server                    # Fastify, Port 3010 (bewusst nicht 3000, siehe .env.example)
npm run dev:web                       # Vite, proxied /api auf :3010
```

Anmelden im Browser (`http://localhost:5173`) mit dem oben gewählten Slug,
E-Mail und Passwort.

**Windows-Schritt-für-Schritt-Anleitung (inkl. Testen vom Handy im selben
WLAN):** siehe [`LOKAL-TESTEN.md`](./LOKAL-TESTEN.md). Ein Cloud-Server
wird erst für den echten Pilotbetrieb mit externen Nutzern gebraucht —
entwickelt und getestet wird lokal.

## Stand

**Phase 1 bis 3 nach `ANFORDERUNGEN.md` §9 sind erreicht, Phase 4 (Oberfläche auf
Niveau des Tiff Cardealer Managers) ist weit fortgeschritten.** Die Web-App
hat: Übersicht, Fahrzeuge (Detail mit allen CH-Feldern, Kosten, Fotos, Verkauf,
Verträge), Inserate (AutoScout24), Anfragen, Kunden, Rechnungen (Zahlungen,
`camt.054`, Mahnwesen, Gutschriften), Werkstatt, Kalender, Belegarchiv (inkl. ZIP-Export und
Integritätsprüfung), Auswertungen (Gewinn, Lagerbestand, MWST), Einstellungen
(Betrieb, Logo, QR-IBAN, AutoScout24, Anfragen-Eingang), Benutzer und Hilfe mit
Einrichtungs-Checkliste. Design: Tiff-Grün/Gold, Barlow, Logo — aus dem Manager
übernommen. Rollen: Inhaber, Buchhaltung, Verkauf, Werkstatt (Firmenzahlen nur
für Inhaber/Buchhaltung, Verwaltung nur für den Inhaber).

**195 automatisierte Tests**, überwiegend gegen eine echte PostgreSQL-Instanz
inkl. RLS-Mandantentrennung und einer Rollenmatrix über HTTP. Ausführen:
`npm test` (Integrationstests brauchen `DATABASE_URL` und `MIGRATE_DATABASE_URL`
aus der `.env`, sonst werden sie übersprungen).

Fehler, die erst echte Datenbank und Bibliotheken ans Licht brachten (eine
reine Unit-Test-Suite hätte sie nicht gefunden):
- ein `node-pg-migrate`-Default mit doppelten Anführungszeichen im SQL,
- ein Absturz in `swissqrbill` bei fehlender Kundenadresse (`null` statt `undefined`),
- das Belegarchiv verglich bei jedem Abruf einen frisch gerenderten Hash — ein
  künftiger Layout-Fix hätte jede historische Rechnung als "Integritätsfehler"
  gemeldet; jetzt kommt ein archiviertes PDF aus dem Speicher,
- Postgres-`DATE`-Spalten kamen als zeitzonenverschobenes JS-Datum an, und
  `findTaxRate` verglich Datum mit Text (immer `false`): der MWST-Satz wurde nie
  nach Datum gewählt,
- ein `DELETE FROM tenants` der Anwendungsrolle hätte über die Kaskade
  archivierte Belege vernichtet, am Trigger vorbei (`session_user` statt
  `current_user`, Löschrecht auf `tenants` entzogen).

## Konfiguration (`.env`)

Siehe `.env.example`. Zusätzlich zu den Datenbank-URLs:
- `APP_SECRET_KEY` (32 Byte, hex oder base64): Schlüssel für Geheimnisse in der
  Datenbank (AutoScout24-Client-Secret, AES-256-GCM). **Im Betrieb Pflicht**
  (`NODE_ENV=production`), lokal reicht ein fester Entwicklungsschlüssel.
- `OBJECT_STORAGE_*`: S3-kompatibler Speicher für Belege, Fotos und Logo.
  Ohne diese Angaben liegt alles unter `data/objects` — nur für die Entwicklung.

**Anfragen von der Website:** unter Einstellungen einen Schlüssel erzeugen (wird
nur einmal angezeigt) und die Website-Adresse hinterlegen. Die Website sendet
dann `POST /api/public/leads/<slug>` mit Header `X-Api-Key`. Der Schlüssel kann
nur Anfragen anlegen; begrenzt auf 10 pro Minute und Adresse (im Speicher dieses
Prozesses — bei mehreren Servern braucht es einen gemeinsamen Speicher).

## Was ein Mensch noch klären oder prüfen muss

- **Kaufvertrag und Ankaufsvertrag** enthalten Entwurfstext (`LEGAL_REVIEW_STATUS`
  in `packages/core-docs/src/kaufvertrag.js`) — vor dem ersten echten Vertrag von
  einem Schweizer Anwalt prüfen lassen.
- **MWST-Auswertung und fiktiver Vorsteuerabzug** sind nach bestem Wissen aus
  MWSTG Art. 28a/24a gebaut, aber nicht von einem Treuhänder bestätigt.
- **Nie gegen echte Infrastruktur gelaufen** (mangels Zugangsdaten): das
  S3-Objektspeicher-Backend, der AutoScout24-Push samt Marken-/Modell-Nachschlagewerken
  (angenommenes Antwortformat in `integrations/autoscout24/lookup.js`) und die
  AutoScout24-Auswahlwerte (Farbe, Treibstoff, Zustand, …) im Fahrzeugformular.
- **Aufbewahrungsfrist** rechnet mit dem Kalenderjahr (Ende des Belegjahres + 10 Jahre);
  ein abweichendes Geschäftsjahr kann sie nur verlängern.

## Noch offen

Fotos an AutoScout24 mitschicken (braucht öffentliche Bild-URLs), Export des Archivs
als Datenstrom für sehr grosse Bestände, Offerte/Auftrag/Lieferschein/Gutschrift
(Tabelle vorbereitet, nicht verdrahtet), Anbindung an `Tiff-Cardealer-Theme-Swiss`.
