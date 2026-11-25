/**
 * Anbindung an "dorfkino filmprogramm 2026", Tab Sheet1.
 * Installation und Zusammenspiel mit bestehendem Newsletter-Script: siehe README.
 * Definiert absichtlich kein onOpen(), um vorhandene Menüs nicht zu ersetzen.
 */
var DORFKINO_SPREADSHEET_ID = 'DEINE_SPREADSHEET_ID';
var DORFKINO_TAB = 'Sheet1';

function dorfkinoMenue() {
  SpreadsheetApp.getUi().createMenu('Kino-Reservierung')
    .addItem('Ausgewählte Filmzeile veröffentlichen / aktualisieren', 'dorfkinoVeroeffentlichen')
    .addItem('Vorschau der ausgewählten Filmzeile', 'dorfkinoVorschau')
    .addToUi();
}

function dorfkinoFilmLesen_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getId() !== DORFKINO_SPREADSHEET_ID) throw new Error('Dieses Script ist für den Filmplan "dorfkino filmprogramm 2026" eingerichtet.');
  var sheet = ss.getActiveSheet();
  if (sheet.getName() !== DORFKINO_TAB) throw new Error('Bitte im Tab Sheet1 eine Filmzeile auswählen.');
  var selection = sheet.getActiveRange();
  if (!selection || selection.getRow() < 2 || selection.getNumRows() !== 1) throw new Error('Bitte genau eine Filmzeile auswählen, nicht die Kopfzeile.');
  var row = selection.getRow();
  var width = Math.max(33, sheet.getLastColumn());
  var headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  var values = sheet.getRange(row, 1, 1, width).getDisplayValues()[0];
  function col(name) {
    var index = headers.indexOf(name);
    if (index < 0) throw new Error('Spalte "' + name + '" fehlt.');
    return index;
  }
  var title = values[col('Titel')].trim();
  var status = values[col('Status')].trim();
  if (!title) throw new Error('Der Filmtitel fehlt.');
  if (status !== 'Aktuell') throw new Error('Zum Veröffentlichen muss der Status "Aktuell" sein.');
  var date = values[col('Date')].trim();
  var first = values[col('Start time')].trim();
  var second = values[col('2nd start')].trim();
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(date) || !first) throw new Error('Datum (TT.MM.JJJJ) und erste Startzeit (HH:mm) eintragen.');
  var starts = [first, second].map(function (time, index) {
    if (!time) return null;
    if (!/^\d{1,2}:\d{2}$/.test(time)) throw new Error('Startzeit muss HH:mm sein, zum Beispiel 17:00.');
    var normalized = ('0' + time.split(':')[0]).slice(-2) + ':' + time.split(':')[1];
    var input = date + ' ' + normalized;
    var value = Utilities.parseDate(input, 'Europe/Berlin', 'dd.MM.yyyy HH:mm');
    if (Utilities.formatDate(value, 'Europe/Berlin', 'dd.MM.yyyy HH:mm') !== input) throw new Error('Datum oder Uhrzeit ist ungültig.');
    if (value.getTime() <= Date.now()) throw new Error('Vergangene Vorstellungen werden nicht veröffentlicht. Datum und Startzeiten prüfen.');
    return { slot: index + 1, iso: value.toISOString(), display: input };
  }).filter(Boolean);
  if (starts.length === 2 && starts[0].iso === starts[1].iso) throw new Error('Die beiden Startzeiten sind gleich.');
  var ticketColumn = col('Ticketlink') + 1;
  var idIndex = headers.indexOf('Reservierungs-ID');
  var id = idIndex >= 0 ? values[idIndex].trim() : '';
  if (id) {
    var ids = sheet.getRange(2, idIndex + 1, Math.max(1, sheet.getLastRow() - 1), 1).getDisplayValues();
    if (ids.filter(function (v) { return v[0].trim() === id; }).length > 1) throw new Error('Doppelte Reservierungs-ID, vermutlich durch Kopieren einer Zeile. In der NEUEN Kopie die Reservierungs-ID leeren und erneut versuchen.');
  }
  return { sheet: sheet, row: row, width: width, headers: headers, title: title, starts: starts, ticketColumn: ticketColumn, idIndex: idIndex, id: id };
}

function dorfkinoVorschau() {
  try {
    var film = dorfkinoFilmLesen_();
    SpreadsheetApp.getUi().alert('Vorschau – keine Änderungen', film.title + '\n\n' + film.starts.map(function (s) { return s.display + ' Uhr · 16 Plätze'; }).join('\n') + '\n\nFreie Sitzwahl · Zahlung vor Ort', SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (error) { SpreadsheetApp.getUi().alert(error.message); }
}

function dorfkinoVeroeffentlichen() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) { SpreadsheetApp.getUi().alert('Ein Import läuft bereits. Bitte kurz warten.'); return; }
  var message;
  try {
    var props = PropertiesService.getScriptProperties();
    var base = (props.getProperty('DORFKINO_API_URL') || '').replace(/\/$/, '');
    var token = props.getProperty('DORFKINO_SYNC_TOKEN') || '';
    if (!/^https:\/\/[^/]+$/.test(base) || token.length < 32) throw new Error('In den Script-Eigenschaften DORFKINO_API_URL (HTTPS ohne Unterpfad) und DORFKINO_SYNC_TOKEN eintragen.');
    var film = dorfkinoFilmLesen_();
    var idColumn = film.idIndex + 1;
    if (film.idIndex < 0) {
      idColumn = film.width + 1;
      if (idColumn > film.sheet.getMaxColumns()) film.sheet.insertColumnsAfter(film.sheet.getMaxColumns(), idColumn - film.sheet.getMaxColumns());
      film.sheet.getRange(1, idColumn).setValue('Reservierungs-ID');
    }
    if (!film.id) {
      film.id = Utilities.getUuid();
      film.sheet.getRange(film.row, idColumn).setValue(film.id);
      SpreadsheetApp.flush();
    }
    var response = UrlFetchApp.fetch(base + '/api/sync', {
      method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ groupId: film.id, events: film.starts.map(function (s) { return { id: film.id + '-' + s.slot, title: film.title, startsAt: s.iso }; }) }),
      muteHttpExceptions: true, followRedirects: false
    });
    var result;
    try { result = JSON.parse(response.getContentText()); } catch (error) { throw new Error('Der Server hat keine gültige Antwort geliefert. Die Reservierungs-ID bleibt gespeichert; nach Beheben des Serverfehlers erneut veröffentlichen.'); }
    if (response.getResponseCode() !== 200) throw new Error(result.error || 'Der Import ist fehlgeschlagen.');
    var expected = base + '/?film=' + encodeURIComponent(film.id);
    if (result.url !== expected || result.count !== film.starts.length) throw new Error('Die Antwort passt nicht zur Filmzeile. Ticketlink wurde nicht geändert.');
    // Zwischenzeitliche manuelle Änderungen oder Sortierung nicht überschreiben.
    if (film.sheet.getRange(film.row, idColumn).getDisplayValue().trim() !== film.id) throw new Error('Die Filmzeile wurde während des Imports verschoben. Bitte die Filmzeile erneut auswählen und veröffentlichen.');
    var cell = film.sheet.getRange(film.row, film.ticketColumn);
    var previous = cell.getFormula() || cell.getDisplayValue();
    if (previous && previous !== result.url && !cell.getNote().includes('Vorheriger Ticketlink:')) cell.setNote(cell.getNote() + '\nVorheriger Ticketlink:\n' + previous);
    cell.setValue(result.url);
    SpreadsheetApp.flush();
    if (cell.getValue() !== result.url) throw new Error('Ticketlink konnte nicht verifiziert werden. Bitte erneut veröffentlichen.');
    message = film.starts.length + ' Vorstellung(en) veröffentlicht.\n\nDer Link steht in der vorhandenen Spalte Ticketlink und führt zur Uhrzeitauswahl. Bestehende Reservierungen bleiben erhalten.';
  } catch (error) { message = error.message; }
  finally { lock.releaseLock(); }
  SpreadsheetApp.getUi().alert(message);
}
