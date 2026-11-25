# Programm und Newsletter

Google Apps Script im Filmprogramm-Sheet des Dorfkinos. Es bildet die Kette vom Film zur Ankündigung:

1. **TMDB-Assistent** (`Code.js`, `Sidebar.html`): Film in der Seitenleiste suchen, Titel, Regie, Laufzeit, Poster, Backdrop und Trailer ins Sheet übernehmen.
2. **Recherche** (`DKC_Recherche.js`): Claude sucht drei bis fünf belegte Zusatzfakten mit Quelle.
3. **Texte** (`DKC_Texte.js`, `DKC_Prompts.js`): Claude schreibt aus Sheet-Daten, Fakten und dem Kommentar des Betreibers Texte für Newsletter, Facebook-Seite, Facebook-Gruppen, Bildzeile und Google Business Profile. Die Regeln dafür stehen editierbar im Tab `Prompts`.
4. **Entwurf und Versand** (`DKC_Entwurf.js`, `DKC_Versand.js`, `DKC_Sendy.js`): Entwurf als E-Mail, Versand über Gmail mit Abmeldelink oder als Kampagnenentwurf in Sendy.
5. **Reservierung** (`DKC_Reservierung.js`): Vorstellungen an die Reservierungs-App im Ordner `app/` übertragen.

Geplant ist als nächster Schritt die Übergabe der Social-Media-Texte an einen Planungsdienst wie SocialBu.

## Einrichtung

Mit [clasp](https://github.com/google/clasp): `.clasp.json.example` nach `.clasp.json` kopieren, eigene Script-ID eintragen, `clasp push`. Schlüssel kommen nicht in den Code, sondern in die Script Properties, nämlich `TMDB_BEARER_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `SENDY_URL`, `SENDY_API_KEY`, `SENDY_BRAND_ID`, `DORFKINO_API_URL`, `DORFKINO_SYNC_TOKEN`, `DKC_WEBAPP_URL`, `DKC_UNSUB_SECRET` und `DKC_EINTRITT`. Tests: Funktionen in `DKC_Tests.js` im Apps-Script-Editor ausführen.

Dieses Produkt nutzt die TMDB-API, ist aber nicht von TMDB unterstützt oder zertifiziert.
