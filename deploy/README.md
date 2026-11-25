# Auslieferung

`git push` schiebt nach GitHub **und** liefert auf Linevast aus. Das Remote
`origin` hat dafür zwei Push-Adressen.

```
git push            # GitHub + Linevast
git push linevast main   # nur ausliefern
```

## Was auf dem Server passiert

Der Push landet im Bare-Repo `/home/deploy/git/dorfkino-reservierung.git`.
Dessen `post-receive`-Hook (Quelle: `deploy/post-receive`):

1. Packt den gepushten Commit nach `/home/deploy/git/.staging-dorfkino` aus.
2. Bricht ab, wenn `app/app.cjs` oder `app/server.js` fehlt.
3. Gleicht `app/` nach `/home/deploy/apps/dorfkino-reservierung/` ab.
4. Führt `npm ci --omit=dev` nur aus, wenn sich `package-lock.json` geändert hat.
5. Berührt `tmp/restart.txt` für den Passenger-Neustart.

Ausgeliefert wird ausschließlich `main`. Andere Branches werden übersprungen.

## Was der Server behält

Nicht überschrieben werden `.env`, `data/`, `node_modules/`, `tmp/`, Logdateien
und `linevast-deploy.zip`. Nicht mit ausgeliefert werden `test/`, `demo.js`,
`google-sheet/`, `app/README.md` und `app/.env.example`.

Der Abgleich läuft **ohne** `--delete`. Eine im Repo gelöschte Datei verschwindet
darum nicht automatisch vom Server; solche Fälle von Hand nachziehen.

## Hook ändern

`deploy/post-receive` bearbeiten, dann `./deploy/install-hook.sh` ausführen.
Das Skript erwartet den Schlüssel `~/.ssh/deploy_key`.

## Umgebung

Server `dein-server.example`, Benutzer `deploy`, Node 22.23.2 über
`~/nodevenv/apps/dorfkino-reservierung/22/bin/activate`, Startdatei `app.cjs`,
Adresse <https://tickets.dorfkinoloegow.de>.

