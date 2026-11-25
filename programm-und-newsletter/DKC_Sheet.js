/**
 * DKC — Sheet-Helfer und Konfiguration.
 * Liest Geheimnisse nur gezielt aus Script Properties; nie listen/löschen.
 * Kopfzeile = Zeile 1 (Task 1.0).
 */

var DKC_HEADER_ROW_ = 1;

/** Default laut Blueprint/decisions.md. Override: Script Property ANTHROPIC_MODEL. */
var DKC_DEFAULT_MODEL_ = 'claude-sonnet-5';

/**
 * Erlaubte Schreib-Modelle (API-IDs, Stand 2026-07-29).
 * Sonnet 5 = Default. Sonnet 4.6 = claude-sonnet-4-6 (Bindestrich, kein Punkt).
 */
var DKC_ALLOWED_MODELS_ = {
  'claude-sonnet-5': true,
  'claude-sonnet-4-6': true,
  'claude-sonnet-4-5': true,
  'claude-sonnet-4-5-20250929': true
};

/**
 * @returns {{ apiKey: string, model: string }}
 */
function dkcGetConfig() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('ANTHROPIC_API_KEY');
  if (!apiKey || !String(apiKey).trim()) {
    throw new Error('ANTHROPIC_API_KEY fehlt in den Script Properties');
  }
  var model = props.getProperty('ANTHROPIC_MODEL');
  model = model && String(model).trim() ? String(model).trim() : DKC_DEFAULT_MODEL_;
  // gängiger Tippfehler
  if (model === 'claude-sonnet-4.6') model = 'claude-sonnet-4-6';
  if (!DKC_ALLOWED_MODELS_[model]) {
    throw new Error(
      'ANTHROPIC_MODEL ungültig: „' +
        model +
        '“. Erlaubt: claude-sonnet-5 (Default), claude-sonnet-4-6'
    );
  }
  return {
    apiKey: String(apiKey).trim(),
    model: model
  };
}

/**
 * Liest und validiert eine Filmzeile.
 * Ohne zeilenNr: aktive Zeile über vorhandenes getTargetRow_().
 *
 * @param {number=} zeilenNr
 * @param {GoogleAppsScript.Spreadsheet.Sheet=} sheet
 * @returns {{ok:true, daten:Object}|{ok:false, fehler:string}}
 */
function dkcLeseFilmzeile(zeilenNr, sheet) {
  sheet = sheet || SpreadsheetApp.getActiveSheet();
  var row = zeilenNr;

  if (row === undefined || row === null || row === '') {
    // getTargetRow_() springt von Zeile 1 auf lastRow+1 (TMDB-Schreibziel).
    // Für DKC: markierte Kopfzeile ist ein Abbruch, kein stilles Umleiten.
    var activeRow = sheet.getActiveCell().getRow();
    if (activeRow === DKC_HEADER_ROW_) {
      return {
        ok: false,
        fehler: 'Bitte eine Filmzeile markieren (Zeile ' + DKC_HEADER_ROW_ + ' ist die Kopfzeile).'
      };
    }
    row = getTargetRow_();
  }
  row = Number(row);

  if (!isFinite(row) || row < 1 || Math.floor(row) !== row) {
    return { ok: false, fehler: 'Ungültige Zeilennummer.' };
  }

  if (row === DKC_HEADER_ROW_) {
    return {
      ok: false,
      fehler: 'Bitte eine Filmzeile markieren (Zeile ' + row + ' ist die Kopfzeile).'
    };
  }

  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(DKC_HEADER_ROW_, 1, 1, lastCol).getValues()[0];
  var values = sheet.getRange(row, 1, 1, lastCol).getValues()[0];

  var daten = {};
  var i;
  for (i = 0; i < headers.length; i++) {
    var key = headers[i];
    if (key === null || key === undefined || String(key).trim() === '') {
      continue;
    }
    key = String(key);
    daten[key] = dkcCellToValue_(values[i], key);
  }

  var titel = dkcTrim_(daten['Titel']);
  if (!titel) {
    return { ok: false, fehler: 'Kein Titel in Zeile ' + row + ' (Spalte Titel).' };
  }

  var dateVal = dkcTrim_(daten['Date']);
  if (!dateVal) {
    return { ok: false, fehler: 'Spalte Date fehlt oder ist leer in Zeile ' + row + '.' };
  }

  var startVal = dkcTrim_(daten['Start time']);
  if (!startVal) {
    return { ok: false, fehler: 'Spalte Start time fehlt oder ist leer in Zeile ' + row + '.' };
  }

  var status = dkcTrim_(daten['Status']);
  if (status !== 'Aktuell') {
    var gezeigt = status === '' ? '(leer)' : status;
    return {
      ok: false,
      fehler: 'Status ist \u201e' + gezeigt + '\u201c in Zeile ' + row + ', erwartet \u201eAktuell\u201c (Spalte Status).'
    };
  }

  daten._zeile = row;
  return { ok: true, daten: daten };
}

/** @private */
function dkcTrim_(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/**
 * Zellenwerte für Objekt-Mapping.
 * Wichtig: Spalten „Start time" / „2nd start" sind in Sheets oft Date-Objekte
 * (Uhrzeit auf Epoch-Tag). Als dd.MM.yyyy formatiert verschwindet die Uhrzeit —
 * das Modell erfindet dann z. B. 20:00. Deshalb spaltenabhängig formatieren.
 * @private
 */
function dkcCellToValue_(v, headerName) {
  if (v === null || v === undefined) return '';
  var h = String(headerName || '');
  var tz = Session.getScriptTimeZone() || 'Europe/Berlin';

  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    if (h === 'Start time' || h === '2nd start') {
      return Utilities.formatDate(v, tz, 'HH:mm');
    }
    if (h === 'Date' || h === 'Release-Date') {
      return Utilities.formatDate(v, tz, 'dd.MM.yyyy');
    }
    if (h === 'date hide') {
      return Utilities.formatDate(v, tz, 'yyyy.MM.dd');
    }
    // Heuristik: Sheets-Zeit-only liegt oft auf 1899/1900
    if (v.getFullYear() < 1950) {
      return Utilities.formatDate(v, tz, 'HH:mm');
    }
    return Utilities.formatDate(v, tz, 'dd.MM.yyyy');
  }

  // Bereits String: Zeiten normalisieren „17:00:00" → „17:00"
  if ((h === 'Start time' || h === '2nd start') && typeof v === 'string') {
    var m = String(v).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);
    if (m) {
      return (m[1].length === 1 ? '0' + m[1] : m[1]) + ':' + m[2];
    }
  }
  return v;
}
