# Tiff Autohändler Manager — Bedienung

Eine Einführung für den Betrieb: was wo zu tun ist, in der Reihenfolge, in der die Arbeit
anfällt. Die technische Seite steht in `README.md` und `LOKAL-TESTEN.md`.

## Anmelden und Rollen

Die Anmeldung braucht drei Angaben: **Betrieb** (der Kurzname, z. B. `demo`), **E-Mail** und
**Passwort**. Jede Person hat eine Rolle, die bestimmt, was sie sieht:

| Rolle | Sieht und darf |
|---|---|
| Inhaber | alles, auch Benutzer und Betriebsdaten |
| Buchhaltung | Firmenzahlen, Auswertungen, Rechnungswesen, Archiv-Export |
| Verkauf | Fahrzeuge mit Preisen und Wirtschaftlichkeit, Kunden, Anfragen, Rechnungen, Verträge — keine Firmensummen |
| Werkstatt | Fahrzeuge ohne Einkaufspreise, Aufträge, Kosten, Kalender — kein Rechnungswesen |

Benutzer legt der Inhaber unter **Benutzer** an. Wer gesperrt wird, ist sofort abgemeldet.

## Einrichtung (einmal, vor der ersten Rechnung)

**Hilfe** zeigt eine Checkliste, die sich selbst abhakt. Nötig sind unter **Einstellungen**:

1. Firma, Adresse, UID — erscheinen auf Rechnung, Verträgen und im QR-Zahlteil.
2. MWST-Abrechnungsart (effektiv oder Saldosteuersatz) — mit dem Treuhänder festlegen.
3. Geschäftsjahr-Ende (Standard Dezember) — bestimmt die Aufbewahrungsfrist im Archiv.
4. QR-IBAN von der Bank — ohne sie hat die Rechnung keinen Zahlteil und wird nicht archiviert.
5. Optional: Logo für die PDFs, AutoScout24-Zugangsdaten, Schlüssel für Anfragen von der Website.

## Der Alltag: vom Fahrzeug zur bezahlten Rechnung

### 1. Fahrzeug erfassen

**Fahrzeuge → Fahrzeug erfassen.** Marke, Modell, Stammnummer, Erstzulassung, Kilometer, MFK,
Einkaufspreis und Angebotspreis. Beim Kauf von einer Privatperson rechnet das System den
fiktiven Vorsteuerabzug selbst aus (Art. 28a MWSTG); nichts eintippen.

Im Fahrzeug-Detail:

- **Kosten** (Aufbereitung, Teile, Transport, Gebühren) — jede Zeile mindert den Gewinn.
- **Fotos** hochladen, Titelbild wählen, Reihenfolge mit den Pfeilen ändern.
- **Verträge:** Ankaufsvertrag beim Einkauf, Kaufvertrag beim Verkauf. Vorschau ansehen, dann
  «Ausstellen und archivieren» — erst dann gibt es eine Nummer.

### 2. Werkstatt

**Werkstatt → Auftrag erfassen:** Art (Teil, Arbeit, Aufbereitung …), Beschreibung, Schätzung,
Frist. Das Board zeigt pro Fahrzeug, was offen und was in Arbeit ist. Wird ein Auftrag mit
Betrag erledigt, entsteht die Kostenzeile am Fahrzeug von selbst. Fristen erscheinen im Kalender.

### 3. Inserieren

**Inserate** zeigt pro Fahrzeug, ob es für AutoScout24 bereit ist und was noch fehlt
(Farbe, Karosserieform, Zustand …). «Übertragen» schickt Fahrzeugdaten und Fotos hinauf —
Einkaufspreis, Verkaufspreis und Käuferdaten gehen nie mit. Danach «Aktivieren». Ändern sich
Fotos, zeigt die Inserate-Seite «ausstehend»; «Fotos übertragen» setzt die Reihenfolge dort neu.
Beim Verkauf wird das Inserat automatisch deaktiviert.

### 4. Anfragen und Kunden

**Anfragen** sammelt Interessenten — von Hand, von der Website oder von AutoScout24. Status
(neu, kontaktiert, Probefahrt, gewonnen, verloren), Fahrzeug und interne Notiz. «Zu Kunde
machen» legt den Kunden an, ohne Duplikat. Kunden und Lieferanten stehen unter **Kunden**.
Termine (Besichtigung, Probefahrt, Übergabe) unter **Kalender**.

### 5. Offerte, Auftrag, Lieferschein, Rechnung

**Offerten & Aufträge** führt ein Geschäft Schritt für Schritt:

- **Offerte** (30 Tage gültig) → **Auftrag** (reserviert das Fahrzeug) → **Lieferschein** (mit
  Fahrzeugdaten und Unterschriftsfeldern, ohne Preise) → **Rechnung**.
- Jeder Schritt übernimmt Kunde, Fahrzeug und Positionen. Nichts wird neu getippt.
- Jeder Beleg wird beim Ausstellen unveränderlich archiviert. Fehler korrigiert man nicht durch
  Überschreiben: Offerte ablehnen und neu ausstellen, Auftrag stornieren, Rechnung per
  Gutschrift ausgleichen.

Eine Rechnung kann auch direkt entstehen (**Rechnungen → Rechnung erstellen**), etwa für
Zubehör ohne Fahrzeug. Mit der Rechnung ist der Verkauf abgeschlossen: Das Fahrzeug gilt als
verkauft, Verkaufspreis ist das Rechnungstotal inkl. MWST.

### 6. Zahlungen und Mahnungen

Im Rechnungs-Detail Zahlungen von Hand erfassen oder die **camt.054-Datei der Bank** unter
Rechnungen einlesen — das System ordnet die Zahlungen über die QR-Referenz zu. Dieselbe Datei
zweimal einzulesen bucht nichts doppelt. Überfällige Rechnungen bekommen per Knopf eine
Mahnung (1. bis 3. Mahnung mit Verzugszins); ab der dritten entscheidet ein Mensch.

### 7. Gutschriften

Ganze Rechnung oder Teilbetrag, immer mit Grund. Die Gutschrift senkt den offenen Betrag,
stoppt Mahnungen und mindert Umsatz und MWST in der Periode der Ausstellung. Eine
Teilgutschrift mindert den Verkaufspreis des Fahrzeugs, eine Vollgutschrift hebt den Verkauf auf.

## Überblick behalten

- **Dashboard:** Fahrzeuge auf Lager, gebundenes Kapital, erwarteter Gewinn, Verkäufe des
  Jahres, neue Anfragen, offene Werkstattaufträge, überfällige Rechnungen, MFK-Fristen, lange
  Standzeiten und was noch zu erledigen ist. Firmenzahlen sehen nur Inhaber und Buchhaltung.
- **Auswertungen:** Verkäufe und Gewinn je Zeitraum, Lagerbestand nach Alter, MWST-Abrechnung
  (Entwurf, vom Treuhänder zu bestätigen).
- **Kalender:** MFK-, Rechnungs- und Auftragsfristen aus den Daten, dazu eigene Termine.

## Archiv

**Archiv** listet alle ausgestellten Belege mit Prüfsumme und Aufbewahrungsfrist (10 Jahre ab
Ende des Geschäftsjahres, OR 958f). «Prüfen» kontrolliert, ob die Datei noch dem Hash
entspricht. «Alles exportieren» liefert ein ZIP mit allen PDFs, einem Index und einer
Anleitung zum Nachprüfen — für Treuhänder oder Revision.

## Was das System nicht entscheidet

Die MWST-Behandlung, Kauf- und Ankaufsvertrag sowie die Mahnstufe 3 (Betreibung) sind Vorlagen
und Entwürfe. Treuhänder, Anwalt und Bank bestätigen sie, bevor der erste echte Beleg hinausgeht.
