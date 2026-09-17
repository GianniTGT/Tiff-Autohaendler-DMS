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
    server/      Node 22 + Fastify
    web/         React 18 + Vite + Tailwind
```

## Entwicklung

```bash
npm install
npm test                              # alle Packages
npm run test:boundary                 # Mandantengrenze (Quelltext-Test)
cp .env.example .env                  # DATABASE_URL setzen
npm run migrate                       # Postgres-Schema aufbauen
npm run dev:server                    # Fastify, Port 3000
npm run dev:web                       # Vite, proxied /api auf :3000
```

## Stand

Phase 0 nach `ANFORDERUNGEN.md` §9: Grundgerüst, Mandantenfähigkeit, Geld in
Rappen, MWST-Tabelle, CH-Fahrzeugschema, Rollen-Kern, QR-Rechnung-Anbindung,
Vertrags-PDF-Gerüst, i18n-Startbestand. **Kaufvertrag und Ankaufsvertrag
enthalten noch keinen rechtsgültigen Text** — siehe `LEGAL_REVIEW_STATUS` in
`packages/core-docs/src/kaufvertrag.js`, das muss vor dem ersten echten
Vertrag von einem Schweizer Anwalt geprüft werden.

Phase 1 (nächster Schritt): Login, Fahrzeugerfassung, Kunden/Lieferanten,
Rechnung mit QR-Zahlteil ausgeben, MWST-Maschine ans Fahrzeug anschliessen.
