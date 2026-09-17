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
  core-billing/  Geld (Rappen), MWST, Wirtschaftlichkeit, QR-Rechnung
  core-docs/     PDF-Layout, Kaufvertrag/Ankaufsvertrag-Gerüst
  core-ui/       Übersetzungs-Lookup (nur de-CH)
apps/
  cardealer-ch/
    server/      Node 22 + Fastify — src/routes (HTTP), src/services (DB via withTenant()), src/plugins (Auth/Cookies)
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

**Phase 1 und Phase 2 nach `ANFORDERUNGEN.md` §9 sind erreicht, Ende zu Ende
geprüft:** Login (Mandanten-Slug + E-Mail + Passwort, RLS-sichere Sitzung),
Fahrzeuge erfassen/auflisten (CH-Felder, fiktiver Vorsteuerabzug automatisch
berechnet), Kunden/Lieferanten erfassen/durchsuchen, Rechnung mit
MWST-Berechnung und Nummernkreis, PDF mit QR-Zahlteil, Zahlungen manuell oder
per `camt.054`-Import (automatischer Abgleich über die QR-Referenz,
idempotent), Mahnwesen (1./2./3. Mahnung mit Verzugszins nach OR 104),
MWST-Auswertung effektiv/Saldosteuersatz, Belegarchiv (PDF-Hash, geprüft statt
überschrieben) — im Browser durchgeklickt und mit 105 automatisierten Tests
abgesichert (66 davon im Server, gegen eine echte PostgreSQL-Instanz inkl.
RLS-Mandantentrennung).

Zwei echte Fehler kamen dabei ans Licht, die eine reine Unit-Test-Suite ohne
echte Datenbank nie gefunden hätte: ein `node-pg-migrate`-Default mit
doppelten Anführungszeichen (verletzte den `status`-Constraint) und ein
Absturz in `swissqrbill`, wenn die Kundenadresse fehlt (Postgres liefert
`null`, nicht `undefined`) — beide behoben, mit Regressionstest.

**Kaufvertrag und Ankaufsvertrag enthalten noch keinen rechtsgültigen
Text** — siehe `LEGAL_REVIEW_STATUS` in `packages/core-docs/src/kaufvertrag.js`,
das muss vor dem ersten echten Vertrag von einem Schweizer Anwalt geprüft
werden. Die Rechnungs-QR-Referenz ist technisch korrekt (gegen das offizielle
SIX-Beispiel getestet), aber ohne bestellte QR-IBAN provisorisch — siehe
ANFORDERUNGEN.md §10. Die MWST-Auswertung ist nach bestem Wissen aus MWSTG
Art. 28a/24a gebaut, aber nicht von einem Treuhänder bestätigt.

**Noch nicht gebaut** (Phase 3 nach ANFORDERUNGEN.md §9): AutoScout24-Anbindung,
eigene Website-Anbindung, echter Objektspeicher für PDF-Dateien (bisher nur
der Hash archiviert, nicht die Datei selbst). Offerte, Auftrag, Lieferschein
und Gutschrift existieren als Datenbanktabelle (siehe `documents.type`), sind
aber noch nicht verdrahtet — nur `invoice` und `reminder` sind es.
