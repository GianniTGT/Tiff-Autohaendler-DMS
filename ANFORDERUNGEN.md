# Tiff Autohändler DMS — Anforderungen und Architektur

**Stand: 17. September 2026.** Dieses Dokument beantwortet die Ausgangsfrage — *„schaue alles
was zu diesem Markt passt und was gemacht werden muss"* — und ist die Grundlage für alles,
was in diesem Repo gebaut wird. Es fasst drei Quellen zusammen, gelesen am 17. September:

- `Tiff-Cardealer-Manager` (die bestehende US-Software für Downtown Auto Sales, Anchorage/Alaska,
  Electron-Desktop-App, lokal, Englisch) — inklusive ihrer `CLAUDE.md` §27 und `AUTOSCOUT24-API.md`
- `Tiff-Cardealer-Theme-Swiss` (`business/SCHWEIZ-SAAS.md`, `business/BETRIEB-UND-HOSTING.md`) —
  die bereits bestehende Architektur- und Geschäftsanalyse für die Schweiz
- Die Offerte an den ersten Schweizer Kunden (`business/offerte/offerte-bit-automobile.html`)

## 0. Die Entscheidung ist bereits gefallen — an anderer Stelle

`Tiff-Cardealer-Manager` hatte in Version 1.7.0 kurzzeitig einen Länder-Umschalter (USA/CH) als
Feld im Händlerprofil. **Das war nie das Schweizer Produkt, sondern ein Demo-Fahrzeug, um es
dem Interessenten Sabit zu zeigen** — `CLAUDE.md` §27 hält das ausdrücklich fest und begründet,
warum ein Fork der Electron-App falsch wäre: er würde SQLCipher, DPAPI, den Installer, das
Backup-Modul, die Telefon-VIN-Brücke und `webContents.print()` mitschleppen — nichts davon
braucht eine Schweizer Cloud-Lösung, und der ~60 % gemeinsame Kern würde doppelt gepflegt.

**Dieses Repo ist genau die Konsequenz daraus:** ein zweites, eigenständiges Produkt, das die
Fachlogik erbt, aber nicht die US-Altlasten. Kein Länder-Umschalter — dieses Repo kennt nur die
Schweiz, nur Deutsch.

## 1. Scope

| | |
|---|---|
| **Markt** | Ausschliesslich Schweiz |
| **Sprache** | Ausschliesslich Deutsch (`de-CH`). Kein Sprachumschalter, kein Englisch, kein US-Vokabular im Code |
| **Währung** | Ausschliesslich CHF, Beträge als Ganzzahl in Rappen (nicht `REAL`/Fliesskomma — siehe §4) |
| **Recht** | Schweizer Recht: OR (Kaufrecht, Gewährleistung), MWSTG (MWST auf Fahrzeughandel), revDSG (Datenschutz) |
| **Rechnungsformat** | Schweizer QR-Rechnung (seit 30.9.2022 einziges gültiges Format) |
| **Verträge** | Ankaufsvertrag (Privatkauf) und Kaufvertrag nach AGVS/UPSA-Muster — beide fehlen im US-Repo vollständig und sind hier Neubau |
| **Zielkunde (Pilot)** | ImmoBit AG / bit-automobile.ch, Sabit Kadriu, Oberwangen b. Bern (siehe Offerte) |
| **Zugriff** | Laut Offerte an den Piloten: *„Im Browser, von überall · tägliche Sicherung · Datenexport jederzeit"* — das ist eine Web-/Cloud-Anwendung, **kein Desktop-Installer** |

## 2. Was aus `Tiff-Cardealer-Manager` übernommen wird

Gemessen im US-Repo (siehe Analyse unten), **~2'200 Zeilen "neutraler Kern"**, der keine
US- oder Auto-Branchen-Annahmen enthält und wörtlich bzw. mit kleiner Anpassung übernommen
werden kann:

| Modul (US-Repo) | Wird hier zu | Anpassung |
|---|---|---|
| `lib/economics.js` | `packages/core-billing` | keine — reiner Rechenkern (Einkauf + Teile + Arbeit + Sonstiges → Gewinn/Marge) |
| `lib/balance.js`, `lib/installment-plan.js` | `packages/core-billing` | keine |
| `lib/timeline.js`, `lib/calendar.js`, `lib/statistics.js`, `lib/dashboard.js` | `apps/cardealer-ch/server` | keine (nur async statt synchron auf Postgres umgestellt) |
| `lib/recon.js` | `apps/cardealer-ch/server` | keine |
| `lib/customers.js`, `lib/vehicle-search.js` | `apps/cardealer-ch/server` | keine |
| `lib/roles.js` | `packages/core-auth` | Rollen neu: nicht `manager`/`sales` übernehmen, sondern `inhaber`/`verkauf`/`werkstatt`/`buchhaltung` — ein Schweizer Kleinbetrieb ist anders geschnitten als der US-Kunde (siehe SCHWEIZ-SAAS.md §1.4) |
| `lib/locale.js` (Muster) | `packages/core-billing/src/money.js` | Geld auf Ganzzahl-Rappen umgestellt, kein Region-Umschalter — CH ist der einzige Fall |
| `lib/documents/layout.js` | `packages/core-docs` | PDF-Layout-Grundbausteine sind branchenneutral, wörtlich übernehmbar |
| `lib/sync/payload.mjs` (Muster `assertNoFinancialData`) | `apps/cardealer-ch/server` | Muster (Whitelist für alles, was nach draussen geht) übernehmen, Ziel ist AutoScout24 statt WordPress (§5) |
| `src/i18n/de.json` (816 von 1249 Strings bereits auf Deutsch) | `apps/cardealer-ch/web/src/i18n/de.json` | als Startbestand für Dashboard/Inventar/Kunden/Einstellungen — **die 245 Advertising-Strings (Website/Facebook/Ads) werden nicht übernommen**, da dort Craigslist &Co. drinstecken |

## 3. Was ausdrücklich NICHT übernommen wird

| | Warum |
|---|---|
| `lib/social/*` (Facebook-, Instagram-Posting) inkl. Craigslist-Kanal in `lib/listing-fields.js` | **Craigslist gibt es in der Schweiz nicht.** Facebook/Instagram-Posting ist für den Piloten nicht Teil des Angebots — die Offerte nennt nur AutoScout24-fähige Inserate. Wird durch die AutoScout24-DMS-API ersetzt (§5) |
| `lib/documents/billOfSale.js`, `buyersGuide.js`, `odometerStatement.js` | Beziehen sich wörtlich auf **16 CFR 455** (FTC Buyers Guide), **49 CFR 580** (US-Bundes-Kilometerstand-Offenlegung) und Alaska DMV Form V6 — US-Bundesrecht, in der Schweiz bedeutungslos. Ersetzt durch Ankaufsvertrag/Kaufvertrag CH (§7) |
| `vehicles.plate`, `title_status`, `warranty_kind`, `odometer_status` (US-Spalten) | Alaska-Kennzeichen- und Title-Recht bzw. FTC-Garantiekategorien — kein Schweizer Äquivalent. `warrantyType` bei AutoScout24 ist etwas anderes und nicht übersetzbar (siehe `AUTOSCOUT24-API.md` §3) |
| `theme/` (Snapshot des US-WordPress-Themes im Manager-Repo) | Stale, nicht Teil des Electron-Builds. Das eigentliche Schweizer Theme liegt in `Tiff-Cardealer-Theme-Swiss` — separates Repo, nicht hier |
| Lokal-first-Module: `lib/backup.js`, `recovery-code.js`, `data-root.js`, `machine-key.js`, `firewall.js`, `vin-bridge.js`, `vin-server.js`, `electron/keystore.js`, `migrate-userdata.js`, `session.js` (~2'150 Zeilen) | Existieren nur, weil die US-Version Daten auf einem einzelnen Windows-Rechner hält (SQLCipher-Schlüssel, DPAPI, Telefon-LAN-Brücke). In der Cloud gibt es das nicht: Backup ist eine Hoster-Einstellung, Passwort-Vergessen ist eine E-Mail (SCHWEIZ-SAAS.md §1.3) |
| Länder-/Region-Umschalter (`lib/dealer-fields.js` Region-Feld, `DealerField.jsx`) | Dieses Produkt kennt nur einen Markt. Kein Umschalter nötig oder gewollt |
| `electron/`, Installer, `electron-builder`-Konfiguration | Web-Anwendung statt Desktop-Installer (siehe Offerte: „im Browser, von überall") |

## 4. Architektur

Folgt der bereits bestehenden Empfehlung in `SCHWEIZ-SAAS.md` §2–§3, bestätigt durch
`CLAUDE.md` §27 (dortige Bezeichnung: `tiff-suite`):

```
tiff-autohaendler-dms/          npm workspaces, ein Repo
  packages/
    core-db/       Migrationen, withTenant(), Row-Level-Security
    core-auth/     Sitzungen, Rollen, Einladungen, Audit
    core-parties/  Kontakte, Firmen, Personen (Kunden, Lieferanten)
    core-billing/  Geld (Rappen), MWST, Belege, Nummernkreise, QR-Rechnung
    core-ui/       React-Basis: Tabellen, Formulare, Icons, i18n (de-CH)
    core-docs/     PDF-Layout (aus lib/documents/layout.js), Vertragsvorlagen
  apps/
    cardealer-ch/
      server/      Node 22 + Fastify, HTTP-API
      web/         React 18 + Vite + Tailwind
```

| Schicht | Wahl | Begründung |
|---|---|---|
| Frontend | React 18 + Vite + Tailwind | identische Bibliotheken wie im US-Repo — die Fachlogik-Muster (Components, Hooks) übertragen sich |
| Backend | Node 22 + Fastify | gleiche Sprache wie `lib/`, portierte Module laufen ohne Übersetzung |
| Datenbank | PostgreSQL 16+, `pg`, `node-pg-migrate`, Row Level Security | Mandantenfähigkeit von Tag eins, siehe `packages/core-db` |
| Geld | `bigint`, Einheit Rappen | `REAL` im US-Schema ist für eine MWST-pflichtige Rechnung mit Rundung nicht tragbar (SCHWEIZ-SAAS.md §4.1) |
| Auth | Server-Session, `httpOnly`-Cookie, `scrypt` (aus `lib/auth.js` übernehmbar) | kein JWT — eine deaktivierte Person muss sofort draussen sein |
| PDF | `pdfkit`, `lib/documents/layout.js` als Basis | bereits im US-Repo bewährt |
| QR-Rechnung | `swissqrbill` (npm) | nicht selbst bauen — SIX-Spezifikation hat zu viele Detailfehlerquellen |

## 5. CH-Fahrzeugfelder und AutoScout24

`AUTOSCOUT24-API.md` (im US-Repo, 15.9.2026 verfasst) ist bereits Schweiz-spezifische
Recherche und wird hier direkt verwertet — **wichtigster Befund: die Richtung ist DMS →
AutoScout24 (Push), nicht umgekehrt.** AutoScout24 ist als DMS-Partner-Schnittstelle gebaut,
nicht als Quelle. Das bestätigt die vorherige Annahme in `Tiff-Cardealer-Theme-Swiss`, die
Website werde von AutoScout24 gespeist, war falsch — richtig ist: **TCM/DMS erfasst das
Fahrzeug einmal und speist sowohl die eigene Website als auch AutoScout24.**

Benötigte Fahrzeugfelder, die es im US-Schema nicht gibt (aus `AUTOSCOUT24-API.md` §3, deckt
sich mit `SCHWEIZ-SAAS.md` §4.5):

- **Stammnummer** (`\d{3}\.\d{3}\.\d{3}`), **Typenscheinnummer** (`certificationNumber`) — als Text, nicht Zahl
- **Erstzulassungsdatum** — ersetzt `year` (Modelljahr) als Leitdatum; AS24 verlangt beides getrennt
- **MFK**: letzte Prüfung + gültig bis (`inspected`, `lastInspectionDate`)
- **km statt miles** (Direktspeicherung, keine Umrechnung mehr nötig — anders als im US-Repo, das Meilen speichert und umrechnet)
- **kW primär**, PS abgeleitet; Hubraum in cm³ als Ganzzahl (AS24: `cubicCapacity`)
- `vehicleCategory`, `conditionType`, `warrantyType`, `bodyType`, `bodyColor`/`interiorColor` — jeweils als AS24-kompatible Enums, siehe `AUTOSCOUT24-API.md` §4
- `energyLabel`, `co2Emission`, `consumptionCombined` — abrufbar über `GET /vehicle-energy-efficiency/detect` sobald Stammnummer/Typenscheinnummer erfasst sind
- **Nie an AutoScout24 übertragen** (eigene Merkliste im US-Dokument, entspricht der Datenschutzgrenze aus `SCHWEIZ-SAAS.md`): Einkaufspreis, Verkaufspreis, Käuferdaten

**Offene kaufmännische Fragen (nicht technisch), zu klären bevor AutoScout24-Anbindung gebaut wird:**
1. Wie kommt man an `client_id`/`client_secret` — pro Händler oder darf TIFF Software Solutions im Auftrag zugreifen?
2. Was kostet die VIN-Abfrage pro Aufruf? (Kostenlose Alternative: Abfrage über Typenschein- oder Stammnummer)

## 6. MWST — der wichtigste rechtliche Unterschied zur Aufgabenstellung

**Nicht Margenbesteuerung, sondern fiktiver Vorsteuerabzug** (MWSTG Art. 28a) für den
Normalfall — Margenbesteuerung (Art. 24a) gilt in der Schweiz seit 1.1.2018 nur noch für
Sammlerstücke/Oldtimer. Datenmodell pro Fahrzeug (nicht pro Mandant):

```
vat_scheme            'standard' | 'notional_input_tax' | 'margin'
purchase_from         'private' | 'dealer' | 'auction' | 'trade_in'
purchase_vat_amount   Rappen, 0 bei Privatkauf
notional_input_tax    Rappen, berechnet und gespeichert (Beweislage)
```

Sätze seit 1.1.2024: Normalsatz 8.1 % (Fahrzeughandel), reduziert 2.6 %, Beherbergung 3.8 % —
als Tabelle `tax_rates` mit `valid_from`/`valid_to`, nie als Konstante (sie haben sich zuletzt
per 2024 geändert). Zwei Abrechnungsmethoden (effektiv / Saldosteuersatz) sind Mandanten-Einstellung,
ändern die Rechnung nicht, aber die Auswertung.

> **Muss von einem Treuhänder bestätigt werden, bevor die erste Rechnung rausgeht** — siehe
> `SCHWEIZ-SAAS.md` §4.3 und §6. Das gilt unverändert für dieses Repo.

## 7. Verträge und Dokumente (Neubau, kein US-Vorbild)

| Dokument | Rechtsgrundlage | Status |
|---|---|---|
| Ankaufsvertrag (Privatperson → Händler) | Beleg für fiktiven Vorsteuerabzug, 10 Jahre Aufbewahrung (OR 958f) | Neubau, `packages/core-docs` |
| Kaufvertrag (Händler → Kunde) | OR Art. 197 ff., Gewährleistung: Regelfrist 2 Jahre, bei Occasion auf 1 Jahr verkürzbar (Konsumentenschutz-Untergrenze, OR 210 Abs. 4). Muster: AGVS/UPSA | Neubau, **von Schweizer Anwalt zu prüfen** — gleiche Disziplin wie das US-Repo sie für den Bill of Sale hatte (§17 dort) |
| Rechnung mit QR-Zahlteil | QR-Rechnung Pflicht seit 30.9.2022 | `swissqrbill`, `packages/core-billing` |

## 8. Rollen (angepasst, nicht übernommen)

Das US-Repo kennt zwei Rollen (`manager`/`sales`), extra zugeschnitten auf einen
US-Autohändler. **Nicht übernehmen — SCHWEIZ-SAAS.md §1.4 sagt ausdrücklich, das beim Piloten
zu erfragen.** Vorläufige Annahme für Phase 1, zu bestätigen mit Sabit Kadriu:
`inhaber` / `verkauf` / `werkstatt` / `buchhaltung`. Die *Disziplin* aus dem US-Repo (eine
Funktion `canSeeCompanyTotals(role)`, nie `role !== 'x'` über sechs Bildschirme verteilt) wird
übernommen, nicht die konkreten Rollennamen.

## 9. Roadmap

Phasen wie in `SCHWEIZ-SAAS.md` §5 vorgezeichnet, hier konkretisiert:

- **Phase 0 (erledigt):** Monorepo-Grundgerüst, Mandanten/RLS (inkl. der Nachbesserung um
  `tiff_migrator`/`tiff_app` als getrennte Rollen — ein Tabellenbesitzer ist sonst von RLS befreit,
  siehe `packages/core-db/migrations/1700000000004_runtime-role-hardening.js`), Geld in Rappen,
  `tax_rates`, CH-Fahrzeugschema, Rollen-Kern, i18n-Grundgerüst (nur Deutsch)
- **Phase 1 (erledigt, Ende-zu-Ende geprüft):** Login (Mandanten-Slug-Auflösung, RLS-sichere
  Sitzung), Fahrzeuge erfassen/auflisten (CH-Felder), Kunden/Lieferanten erfassen/durchsuchen,
  Rechnung mit MWST-Berechnung, Nummernkreis und QR-Zahlteil als PDF — Leitsatz „Fahrzeug rein,
  Rechnung raus" ist erreicht. Ankaufsvertrag/Kaufvertrag existieren als PDF-Gerüst, aber ohne
  geprüften Rechtstext (§7). Im Browser durchgeklickt und mit 65 automatisierten Tests
  (inkl. Mandantentrennung gegen echtes PostgreSQL) abgesichert.
- **Phase 2 (offen):** Zahlungsabgleich (`camt.054`), Mahnwesen, MWST-Auswertung effektiv/Saldo,
  Belegarchiv mit Hash; Offerte/Auftrag/Lieferschein/Mahnung/Gutschrift ans bestehende
  `documents`-Schema anschliessen (bisher nur `invoice` verdrahtet)
- **Phase 3 (offen):** AutoScout24-Anbindung (Push, siehe §5), eigene Website-Anbindung an
  `Tiff-Cardealer-Theme-Swiss`

## 10. Was ein Mensch klären muss (nicht Code)

Unverändert aus `SCHWEIZ-SAAS.md` §5, hier nochmals verdichtet:

| | |
|---|---|
| Treuhänder | `vat_scheme`, Saldo- oder effektive Abrechnung, fiktiver Vorsteuerabzug bestätigen |
| Bank | QR-IBAN bestellen (dauert Tage bis Wochen), `camt.054`-Bezug klären |
| Anwalt | Kaufvertrag, Gewährleistung, AGB, AVV, Datenschutzerklärung |
| AutoScout24 | Zugangsmodell (pro Händler vs. Auftrag) und VIN-Abfragekosten klären (§5) |
| Pilotkunde (Sabit Kadriu) | Rollenzuschnitt bestätigen (§8), heutige Ablage (Excel/Papier?) für Import |
