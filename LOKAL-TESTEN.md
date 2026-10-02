# Lokal testen (ohne Cloud-Server)

Ein Cloud-Server (z. B. der geplante Hosttech-vServer) wird erst für den
**echten Pilotbetrieb mit externen Nutzern** gebraucht — jemand ausserhalb
deines eigenen Netzwerks, der die App dauerhaft über eine öffentliche URL
erreichen soll. Zum **Entwickeln und Testen** reicht der eigene Laptop,
kostenlos und sofort: "localhost" ist dann einfach dein eigener PC, nicht
irgendein fremder Server.

## Voraussetzungen (einmalig)

- [Node.js 22 LTS](https://nodejs.org) — Next-Next-Finish
- [Git](https://git-scm.com) — Next-Next-Finish
- [PostgreSQL](https://www.postgresql.org/download/windows/)
  (EnterpriseDB-Installer für Windows, aktuell Version 17) — Passwort fürs
  `postgres`-Superuser-Konto merken, Port `5432` lassen. Läuft danach
  unsichtbar im Hintergrund, kein Docker und keine Virtualisierung nötig.

## Projekt holen und einrichten

```bash
git clone https://github.com/GianniTGT/Tiff-Autohaendler-DMS.git
cd Tiff-Autohaendler-DMS
npm install
```

**Windows-PowerShell-Falle:** `psql` ist nach der PostgreSQL-Installation
oft nicht im PATH — PowerShell meldet dann "wurde nicht als Name eines
Cmdlet... erkannt". Falls das passiert, einmalig **für das aktuelle
Terminal-Fenster** nachhelfen (Versionsnummer ggf. anpassen, prüfbar mit
`Get-ChildItem "C:\Program Files\PostgreSQL"`):

```powershell
$env:Path += ";C:\Program Files\PostgreSQL\17\bin"
```

**Datenbank-Rollen einrichten** (einmalig, mit dem Postgres-Superuser-
Passwort von oben — siehe auch README.md "Datenbank-Rollen" für die
Begründung, warum es zwei Rollen statt einer braucht):

```bash
psql -h localhost -U postgres -f packages/core-db/scripts/dev-setup.sql
```

**`.env`-Datei anlegen.** Wichtig: Das ist eine **Datei im Projektordner**,
keine Befehle, die man ins Terminal tippt — `MIGRATE_DATABASE_URL=...` als
PowerShell-Befehl eingegeben scheitert mit "CommandNotFoundException".
Stattdessen:

```powershell
notepad .env
```

öffnet (und legt bei Bedarf an) die Datei. Dort folgende drei Zeilen
hineinschreiben (Passwort aus dem vorigen Schritt eintragen), dann
speichern und Notepad schliessen:

```
MIGRATE_DATABASE_URL=postgres://tiff_migrator:DEIN_PASSWORT@localhost:5432/tiff_autohaendler_dms
DATABASE_URL=postgres://tiff_app:DEIN_PASSWORT@localhost:5432/tiff_autohaendler_dms
PORT=3000
```

**Schema aufbauen und ersten Betrieb anlegen:**

```bash
npm run migrate
npm run seed:dev-tenant --workspace packages/core-db -- \
  --slug=mein-betrieb --name="Mein Betrieb AG" --email=ich@example.com --password="EinPasswort"
```

## Starten

Zwei Terminal-Fenster:

```bash
npm run dev:server
```

```bash
npm run dev:web
```

Browser: **http://localhost:5173** — einloggen mit Slug `mein-betrieb`,
der E-Mail und dem Passwort von oben.

## Vom Handy aus testen (im selben WLAN)

```bash
npm run dev:web -- --host 0.0.0.0
```

Laptop-IP herausfinden (`ipconfig` unter Windows, z. B. `192.168.1.20`),
am Handy `http://192.168.1.20:5173` öffnen. Handy und Laptop müssen im
selben WLAN sein — kein Internet-Server nötig.

## Wann braucht es wirklich einen Server?

Erst wenn:

- **externe Nutzer** zugreifen sollen (Kunden, Pilotbetrieb ausserhalb
  des eigenen Netzwerks) — siehe README.md "Stand" für den aktuellen
  Projektstatus
- **Webhooks von Drittdiensten** eine öffentlich erreichbare URL brauchen
- die App an **Cloud-only-Diensten** hängt, die es lokal nicht gibt

Bis dahin gilt: entwickelt und getestet wird lokal, der Server kommt erst
für den Pilotbetrieb dazu.
