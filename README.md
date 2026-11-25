# Dorfkino-Platzreservierung

Reservierungssystem für das Dorfkino Lögow, ein kleines Kino mit 16 Plätzen je Vorstellung in Brandenburg. Gäste wählen Film und Uhrzeit, geben die Zahl der Plätze, Name und E-Mail an und bezahlen vor Ort. Es gibt keine Konten und keine festen Sitznummern.

## Bestandteile

- `app/`: Node.js-App (ab Node 22.23.2) mit dem eingebauten `node:sqlite`. Buchung, Bestätigung, Stornolink, geschützte Übersicht für das Kino, E-Mail-Versand über SMTP mit Warteschlange, die Neustarts übersteht. Begrenzung der Buchungsanfragen je Absender.
- `app/google-sheet/` und `google-apps-script/`: Google Apps Script, das Vorstellungen aus dem Filmprogramm-Sheet an die App überträgt und einen Newsletter-Entwurf erzeugt.
- `deploy/`: Git-Hook, der nach einem Push die App auf einen Server mit Passenger ausliefert.

## Ausprobieren

```sh
cd app
npm ci
npm test       # 20 Tests
npm run demo   # http://localhost:3000, Verwaltung unter /admin
```

Die Demo nutzt erfundene Vorstellungen, eine eigene Datenbank in `data/demo.sqlite` und verschickt keine E-Mails. Einrichtung für den Betrieb und alle Umgebungsvariablen stehen in `app/README.md` und `app/.env.example`.

## Lizenz

Code unter MIT-Lizenz, siehe `LICENSE`. Das Logo des Dorfkinos fällt nicht unter diese Lizenz. Die Schrift Roboto Slab steht unter der Apache-Lizenz, Quellen in `app/public/assets/QUELLEN.md`.
