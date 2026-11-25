/**
 * DKC — Menü und Orchestrierung.
 * Wird aus dem vorhandenen onOpen() aufgerufen — kein zweites onOpen hier.
 */

/**
 * Zusätzliches Menü „Dorfkino".
 */
function dkcMenuAnhaengen() {
  SpreadsheetApp.getUi()
    .createMenu('Dorfkino')
    .addItem('Entwürfe erzeugen', 'dkcErzeugeEntwuerfe')
    .addSeparator()
    .addItem('Newsletter: Empfänger zählen', 'dkcMenuEmpfaengerZaehlen')
    .addItem('Newsletter: Trockenlauf', 'dkcMenuVersandTrockenlauf')
    .addItem('Newsletter: Test an mich', 'dkcMenuVersandTestAnMich')
    .addItem('Newsletter: Echtversand / Charge', 'dkcMenuVersandEcht')
    .addSeparator()
    .addItem('Prompts-Tab anlegen', 'dkcInitPrompts')
    .addItem('Kanäle-Tab anlegen', 'dkcInitKanaele')
    .addToUi();
}

/**
 * Kette: Zeile → Prompts → Recherche → Texte → Entwurf → Quittung.
 */
function dkcErzeugeEntwuerfe() {
  var ui = SpreadsheetApp.getUi();
  try {
    var zeile = getTargetRow_();
    // Kopfzeile abfangen (getTargetRow_ leitet um)
    var active = SpreadsheetApp.getActiveSheet().getActiveCell().getRow();
    if (active === 1) {
      ui.alert('Bitte eine Filmzeile markieren (Zeile 1 ist die Kopfzeile).');
      return;
    }

    var gelesen = dkcLeseFilmzeile(zeile);
    if (!gelesen.ok) {
      ui.alert(gelesen.fehler);
      return;
    }
    var film = gelesen.daten;

    // Rückfrage wenn bereits Entwurf erzeugt
    var stempel = film['Entwurf erzeugt'];
    if (stempel !== null && stempel !== undefined && String(stempel).trim() !== '') {
      var antw = ui.alert(
        'Erneut erzeugen?',
        'Für diese Zeile gibt es bereits einen Zeitstempel („Entwurf erzeugt": ' +
          String(stempel) +
          '). Es wird ein zweiter Gmail-Entwurf angelegt; der alte bleibt. Fortfahren?',
        ui.ButtonSet.YES_NO
      );
      if (antw !== ui.Button.YES) {
        return;
      }
    }

    var entwuerfe = dkcErzeugeKanaltexte_(film);
    var draftId = dkcErzeugeEntwurf(film, entwuerfe.texte, entwuerfe.fakten);

    // Newsletter zusätzlich als Entwurfs-Kampagne in Sendy (Fehler bricht Gmail nicht ab)
    var sendyInfo;
    try {
      dkcErzeugeSendyKampagne(film, entwuerfe.texte);
      sendyInfo = 'Sendy: Entwurfs-Kampagne „' + (film['Titel'] || '') + '" angelegt (Dorfkino Lögow).';
    } catch (se) {
      sendyInfo = 'Sendy: NICHT angelegt — ' + (se && se.message ? se.message : String(se));
    }

    dkcSchreibeQuittung_(film._zeile || zeile);

    ui.alert(
      'Entwurf erzeugt',
      'Gmail-Entwurf (Social-Texte) angelegt (ID: ' + draftId + ').\n' + sendyInfo,
      ui.ButtonSet.OK
    );
  } catch (e) {
    var msg = e && e.message ? e.message : String(e);
    // nie Keys
    ui.alert('Abbruch', msg, ui.ButtonSet.OK);
  }
}

function dkcErzeugeKanaltexte_(film) {
  var prompts = dkcLesePrompts();
  var recherche = dkcRecherchiere(film, prompts);
  return { texte: dkcSchreibeTexte(film, recherche.fakten, prompts), fakten: recherche.fakten };
}

/**
 * Schreibt Zeitstempel nur in Spalte „Entwurf erzeugt" (legt Spalte an falls nötig).
 * @private
 */
function dkcSchreibeQuittung_(zeilenNr) {
  var sheet = SpreadsheetApp.getActiveSheet();
  var headerRow = 1;
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];
  var col = -1;
  var i;
  for (i = 0; i < headers.length; i++) {
    if (String(headers[i] || '').trim() === 'Entwurf erzeugt') {
      col = i + 1;
      break;
    }
  }
  if (col < 0) {
    col = lastCol + 1;
    sheet.getRange(headerRow, col).setValue('Entwurf erzeugt');
  }

  var stamp = Utilities.formatDate(new Date(), 'Europe/Berlin', 'yyyy-MM-dd HH:mm');
  sheet.getRange(zeilenNr, col).setValue(stamp);
}
