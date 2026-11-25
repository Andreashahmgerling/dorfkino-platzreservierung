# Dorfkino Lögow – Reservierung

Eine eigenständige Node.js-App für **16 Plätze je Vorstellung, Reservierung nach Anzahl, freie Sitzwahl und Zahlung vor Ort**. Keine WordPress-Abhängigkeit. Die kommende Astro-Website und der Newsletter verlinken auf die Buchungsseite.

## Stand der Lieferung

- Funktionsfähige lokale App mit Gästebuchung, Bestätigung auf der Webseite, Stornolink, geschützter Reservierungsübersicht und vorbereitetem SMTP-Versand.
- Google-Apps-Script passend zum tatsächlich gelesenen Filmplan, noch **nicht im Google Sheet installiert oder ausgeführt**. Das vorhandene Sheet wurde nicht verändert.
- Am 09.09.2026 auf Linevast hochgeladen und mit `npm ci --omit=dev` installiert. Node.js 22.23.2 und SQLite direkt auf dem Server geprüft. **Noch nicht betriebsbereit:** SMTP-Einrichtung, vollständiger HTTPS-/Mail-Test und Sheet-Anbindung stehen aus.
- Keine PayPal-/Stripe-Anbindung; gemäß Entscheidung wird vor Ort bezahlt.
- Die Vorschau verwendet ausdrücklich erfundene Testvorstellungen und versendet keine E-Mails.

## Gestaltung und Formular (08.09.2026)

Originales Esel-Logo von dorfkinoloegow.de, Roboto Slab in den auf der Website verwendeten Schnitten 400/500 und die dort konfigurierte Akzentfarbe `hsl(19 31% 35%)`. Logo und Schriften liegen lokal in `public/assets`; die Apache-Lizenz der Schrift ist beigefügt. Das neue Feld „Anmerkungen/Mitglieder“ ist optional. Bestehende Datenbanken werden beim Start um die neue Spalte ergänzt, ohne Buchungen zu entfernen.

## Lokal ausprobieren

Voraussetzung: Node.js 22.23.2 oder neuer.

```sh
npm ci
npm run demo
```

Die Vorschau läuft unter `http://localhost:3000`. Sie speichert Testreservierungen getrennt in `data/demo.sqlite`. Für die lokale Verwaltung `/admin` öffnen: Benutzer `kino`, Passwort `demo-verwaltung-nur-lokal-1234567890`. Dieses bekannte Demo-Passwort niemals für einen öffentlich erreichbaren Betrieb verwenden. Der Demo-Server bindet standardmäßig nur an `127.0.0.1`.

## So arbeiten Gäste damit

1. Film und Startzeit auswählen.
2. Anzahl von 1 bis zu den noch verfügbaren Plätzen, Name und E-Mail eintragen. Optional im mehrzeiligen Feld „Anmerkungen/Mitglieder“ bis zu 1.000 Zeichen ergänzen. Diese Angaben erscheinen in Bestätigung und Verwaltung; sie lösen keine automatische Rabattberechnung aus.
3. Reservieren: Die Plätze werden sofort verbindlich in der Datenbank gebucht. Es gibt kein Kundenkonto und keine festen Sitznummern.
4. Die Bestätigungsseite zeigt die Reservierungsnummer. Die E-Mail enthält zusätzlich den Stornolink. Der Stornolink wird bei der ersten erfolgreichen Buchungsantwort auch auf der Webseite angezeigt.
5. Über den Link die gesamte Reservierung bis zum Vorstellungsbeginn stornieren; danach läuft die Klärung über das Kino. Teilstornierungen sind in dieser Version nicht vorgesehen.

Eine Reservierung hängt nicht vom Erfolg der E-Mail-Zustellung ab. Bei SMTP-Störungen bleibt sie gültig; die E-Mail wird alle fünf Minuten erneut versucht. In der Verwaltung steht dann „E-Mail wartet auf Versand“. Die gespeicherte Buchung und die Versandwarteschlange überstehen Neustarts. SMTP bietet keine garantierte Genau-einmal-Zustellung: Nach einem Abbruch zwischen Annahme und Speicherung des Versandstatus kann eine E-Mail doppelt ankommen.

## Linevast Black einrichten

Die öffentliche Linevast-Dokumentation beschreibt Node.js, npm/SSH und die Verwaltung über ein Hosting-Panel. Im Linevast-Panel wurde am 09.09.2026 Node.js 22.23.2 verifiziert. Alle 20 Tests bestehen auch mit exakt dieser Version. Node.js 22.23.2, die Paketinstallation und eine SQLite-In-Memory-Datenbank wurden direkt auf Linevast erfolgreich geprüft. Der vollständige Passenger-/HTTPS-Betrieb und persistente Buchungen sind noch zu testen.

1. Eine Subdomain auswählen, beispielsweise `tickets.dorfkinoloegow.de`, und dafür HTTPS aktivieren. Dies ist ein Vorschlag, keine bereits eingerichtete Adresse.
2. Node.js-App mit **Node.js 22.23.2 oder neuer** einrichten. Die App verwendet das mitgelieferte `node:sqlite`. Im aktivierten Node-Umfeld prüfen:

   ```sh
   node --version
   node -e "require('node:sqlite'); console.log('SQLite verfügbar')"
   ```

3. Den Inhalt dieses Ordners in das private App-Verzeichnis übertragen. `.env`, Datenbanken und Sicherungen dürfen nicht in einem separat statisch veröffentlichten Dokumentenverzeichnis liegen. Keine lokalen `node_modules` oder Demo-Daten hochladen; serverseitig `npm ci --omit=dev` ausführen.
4. Für ein dauerhaft beschreibbares, **lokales** Datenverzeichnis sorgen. SQLite-WAL benötigt zuverlässige lokale Dateisperren; nicht auf einem NFS-/Netzlaufwerk betreiben. Falls der Tarif nur Netzspeicher oder ältere Node-Versionen bietet, die Speicheranbindung vor dem Livegang auf die vorhandene MariaDB umstellen. Diese Lieferung enthält noch keinen MariaDB-Adapter.
5. `.env.example` als `.env` kopieren und Werte setzen. Alternativ im Panel Umgebungsvariablen hinterlegen. `PUBLIC_URL` muss exakt die HTTPS-Subdomain ohne abschließenden Pfad sein. SMTP-Daten vom tatsächlichen Postfach übernehmen. `MAIL_FROM` muss eine für dieses Postfach zulässige Absenderadresse sein. Existierende Datenschutz- und Impressumsseiten als absolute HTTPS-URLs eintragen.
6. Zwei verschiedene zufällige Geheimnisse erzeugen, jeweils zum Beispiel mit:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Den ersten Wert als `ADMIN_TOKEN`, den zweiten als `SYNC_TOKEN` hinterlegen. Geheimnisse nicht in das Sheet, Newsletter-Links oder Git eintragen. Die `.env` auf dem Server nur für den App-Benutzer lesbar machen.

7. Normaler Start: `npm start`. Wenn das Panel eine Startdatei verlangt, `app.cjs` verwenden. Sie lädt eine vorhandene `.env` und startet den ESM-Server auch aus einem CommonJS-Loader. **Ein dauerhaft laufender Prozess**, keine zusätzlichen Mail-Worker. Der Port wird aus `PORT` übernommen; Bind-Adresse nach Hosting-Vorgabe über `HOST`. Der konkrete Panel-/Passenger-Start ist erst auf Linevast verifizierbar.
8. `/health` muss `{"ok":true}` liefern. `/admin` verlangt Benutzer `kino` und als Passwort den Wert von `ADMIN_TOKEN`.
9. Erst mit einer eigenen E-Mail-Adresse eine Reservierung und Stornierung vollständig testen. Empfang, Absender, Link, HTTPS und erneute Freigabe der Plätze prüfen. Anschließend echte Vorstellungen veröffentlichen und von der Website verlinken.

`TRUST_PROXY=false` ist die konservative Vorgabe. Hinter einem Proxy teilen Besucher damit gegebenenfalls eine Begrenzung von 30 Buchungsanfragen je 15 Minuten. Nur auf `true` setzen, wenn Linevast bestätigt, dass der Proxy `X-Forwarded-For` zuverlässig überschreibt; sonst können Absenderadressen vorgetäuscht werden. Im Black-Panel sind dieser Punkt und der dauerhafte Prozessbetrieb noch abzuklären.

Die App selbst hat keine Plattform- oder Buchungsgebühr. Ob das vorhandene Hosting sämtliche Voraussetzungen ohne Mehrkosten erfüllt, hängt von dieser Prüfung ab. Backups, Updates und Betrieb bleiben eigene Aufgaben.

## Google Sheet und Newsletter anbinden

Quelle: das Google Sheet mit dem Filmprogramm des Kinos, Tab `Sheet1`. Kopfzeile und Beispielzeilen wurden am 07.09.2026 gelesen. Relevant sind:

| Vorhandene Spalte | Verwendung |
| --- | --- |
| C – Titel | Filmtitel auf Buchungsseite und in der Bestätigung |
| Y – Date | Vorstellungsdatum, z. B. `22.09.2026` |
| AA – Start time | Erste Vorstellung, z. B. `15:00` |
| AB – 2nd start | Optional: zweite Vorstellung mit eigener Kapazität von 16 |
| AC – Status | Zum Veröffentlichen muss `Aktuell` eingetragen sein |
| AG – Ticketlink | Gemeinsamer Link zur Uhrzeitauswahl dieses Films |

Der Import sucht nach den tatsächlichen Spaltenüberschriften, nicht nach festen Buchstaben. Auch wenn „Aktuell“ noch eingetragen ist, werden vergangene Termine abgewiesen. Die Zeitzone ist `Europe/Berlin`, inklusive Sommer-/Winterzeit. Die separate Hilfsspalte „date hide“ und andere Film-, Kommentar- oder Newsletterdaten werden nicht verändert oder als öffentliche Beschreibung übernommen.

### Einmalige Einrichtung

1. Im Sheet **Erweiterungen → Apps Script** öffnen.
2. Den Code aus `google-sheet/Dorfkino.gs` als zusätzliche Scriptdatei einfügen. Den vorhandenen Code nicht ersetzen.
3. In den **Script-Eigenschaften** hinterlegen:
   - `DORFKINO_API_URL`: dieselbe HTTPS-Adresse wie `PUBLIC_URL`.
   - `DORFKINO_SYNC_TOKEN`: der serverseitige Wert von `SYNC_TOKEN`.
4. `dorfkinoMenue` einmal ausführen. Für das Menü bei jedem Öffnen im **bereits vorhandenen** `onOpen()` zusätzlich `dorfkinoMenue();` aufrufen. Falls kein `onOpen` existiert, `function onOpen() { dorfkinoMenue(); }` ergänzen. Diese Datei definiert bewusst kein zweites `onOpen`.
5. Die Google-Berechtigungen beim ersten Ausführen prüfen und erteilen. Personen mit Zugriff auf das Apps-Script-Projekt können dessen Script-Eigenschaften lesen; deshalb nur vertrauten Planverantwortlichen Bearbeitungsrechte geben.

### Pro Film

1. Titel, Datum, erste und ggf. zweite Startzeit im bisherigen Filmplan pflegen.
2. Genau eine Filmzeile auswählen; Status `Aktuell` setzen.
3. Optional **Kino-Reservierung → Vorschau** aufrufen. Diese Funktion verändert nichts.
4. **Ausgewählte Filmzeile veröffentlichen / aktualisieren** wählen.
5. Das Script legt rechts neben den bestehenden Daten einmalig `Reservierungs-ID` an – in der derzeitigen Struktur AH – und gibt der Zeile eine feste ID. Anschließend werden bis zu zwei Vorstellungen angelegt und `Ticketlink` befüllt. Der vorherige Ticketlink bzw. dessen Formel wird beim ersten Ersetzen in einer Zellnotiz erhalten.
6. Im Newsletter den Wert aus `Ticketlink` verwenden. Er führt bei zwei Vorstellungen zur Uhrzeitauswahl.

Das bestehende Newsletter-Script wurde nicht eingesehen oder verändert. **Falls es `Ticketlink` selbst mit einem `mailto:`-Link überschreibt, muss diese Stelle angepasst werden**, damit ein vorhandener HTTPS-Reservierungslink erhalten bleibt. Die vorbereitete Anbindung allein kann das Verhalten eines anderen Scripts nicht verhindern.

### Änderungen ohne Doppelungen

- Wiederholt veröffentlichen aktualisiert dieselben Vorstellungen und setzt belegte Plätze nicht zurück.
- Zum Sortieren immer die ganze Tabelle einschließlich `Reservierungs-ID` sortieren.
- Für eine neu kopierte Filmzeile die kopierte `Reservierungs-ID` leeren; doppelte IDs werden erkannt.
- Für eine zusätzliche Vorstellung an einem anderen Tag eine neue Filmzeile verwenden.
- Eine Terminänderung, ein Filmwechsel oder die Entfernung einer zweiten Startzeit mit bestehenden Reservierungen wird abgewiesen. Zuerst die betroffenen Gäste informieren und die Buchungen in der Verwaltung stornieren, dann aktualisieren. Eine automatische Benachrichtigung über Verschiebungen ist nicht implementiert.
- Veränderungen im Sheet werden bewusst erst nach dem Menüaufruf übertragen. Kein stiller Hintergrundabgleich, keine automatische Veröffentlichung von Entwürfen.
- Import und Sheet-Schreibzugriff sind keine gemeinsame Transaktion. Falls nach erfolgreichem Serverimport das Schreiben des Links scheitert, dieselbe Zeile erneut veröffentlichen. Die vorher gespeicherte feste ID verhindert Doppelungen.

## Astro und vorhandene Website

Ein normaler Link aus dem jeweiligen Film genügt:

```astro
<a href={film.ticketlink}>Plätze reservieren</a>
```

`film.ticketlink` muss beim Programmimport aus der bestehenden Spalte `Ticketlink` übernommen werden. Die Buchung bleibt auf der Subdomain und funktioniert auch unabhängig vom Astro-Umbau. Eine iframe-Einbettung ist absichtlich nicht freigeschaltet; die Lösung ist auf direktes Verlinken eingerichtet.

## Betrieb, Sicherung und Grenzen

- Verwaltung: `/admin` zeigt Filme, Auslastung, Namen, E-Mail-Adressen, Anzahl und Versandstatus; vollständige Stornierung möglich. Telefonische Reservierungen können über das normale Formular mit einer vereinbarten Bestätigungsadresse erfasst werden. Eine separate Telefonbuchungsmaske ist nicht enthalten.
- Datenbank: `DATABASE_PATH`, einschließlich der SQLite-Begleitdateien im laufenden Betrieb. Nicht nur die Hauptdatei bei laufendem Prozess kopieren.
- Konsistente Sicherung: `npm run backup`. Das Script verwendet die SQLite-Backup-API. Die Sicherung liegt unter `backups/`; regelmäßig in ein geschütztes externes Backup übernehmen. Automatische Zeitplanung und Aufbewahrung wurden noch nicht eingerichtet.
- Wiederherstellung: App stoppen, alte Datenbank samt etwaigen WAL-/SHM-Dateien beiseite verschieben, geprüfte Sicherung als `DATABASE_PATH` einsetzen, mit demselben App-Benutzer starten und Reservierungsbestand kontrollieren.
- Personenbezogene Daten bleiben in der App-Datenbank; sie werden nicht ins Filmplan-Sheet zurückgeschrieben. Für E-Mails wird der konfigurierte SMTP-Anbieter verwendet. Eine automatische Löschfrist ist noch nicht implementiert; eine zum Kinobetrieb passende Aufbewahrung vor Livegang festlegen.
- Es werden keine Sitznummern an Gäste vergeben. Die 16 internen Kapazitätsplätze sind nur die technische Überbuchungssperre.
- Noch nicht enthalten: Warteliste, QR-Einlass, Teilstornierung, Onlinezahlung, frei buchbare Privatkino-Termine.

## Validierung

`npm test` prüft Datenbank- und HTTP-Abläufe. Zum Lieferzeitpunkt bestehen 20 Tests, darunter 24 konkurrierende Buchungsanfragen mit genau 16 Erfolgen, atomare Gruppenbuchung, unabhängige Startzeiten, Wiederholung nach Netzwerkfehler, Storno, Persistenz nach Neustart, Wiederherstellung einer Sicherung bei laufender WAL-Datenbank, Import-Wiederholungen und Zugriffsschutz. Syntax von Server, Browser-Script, Backup und Apps Script wurde separat geprüft.

Getestet wurde lokal mit Node.js 26.4.0, Node.js 24 und mit der bei Linevast ausgewählten Version 22.23.2. Ein Live-Test auf Linevast, echter SMTP-Empfang und die Ausführung im Google-Apps-Script-Projekt stehen noch aus. Es wurde keine visuelle Browserprüfung durchgeführt.

## Geprüfte technische Quellen

- [Linevast: Node.js-Hosting, npm/SSH und Versionsauswahl](https://linevast.de/angebote/nodejs-hosting.html)
- [Node.js: SQLite und Backup-API](https://nodejs.org/api/sqlite.html)
- [Google: UrlFetchApp für den HTTPS-Import](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app)
- [Google: Utilities, Datumsverarbeitung mit Zeitzone](https://developers.google.com/apps-script/reference/utilities/utilities)
