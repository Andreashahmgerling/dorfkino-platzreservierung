/**
 * DKC — feste Kanal-URLs (Facebook-Seite, Gruppen, GBP).
 * Einmal im Sheet-Tab „Kanäle" pflegen; erscheinen im Gmail-Entwurf zum schnellen Posten.
 *
 * Spalten: Kanal | Name | URL
 * Kanal-Werte: facebook_seite | facebook_gruppe | gbp
 */

var DKC_KANAELE_SHEET_NAME_ = 'Kanäle';

/**
 * Liest Tab Kanäle. Fehlt der Tab oder sind Zeilen leer → leere Listen (kein Abbruch).
 * @returns {{
 *   facebook_seite: Array<{name:string,url:string}>,
 *   facebook_gruppen: Array<{name:string,url:string}>,
 *   gbp: Array<{name:string,url:string}>
 * }}
 */
function dkcLeseKanaele() {
  var out = {
    facebook_seite: [],
    facebook_gruppen: [],
    gbp: []
  };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(DKC_KANAELE_SHEET_NAME_);
  if (!sh || sh.getLastRow() < 2) return out;

  var data = sh.getRange(2, 1, sh.getLastRow(), 3).getValues();
  var i;
  for (i = 0; i < data.length; i++) {
    var kanal = String(data[i][0] || '')
      .trim()
      .toLowerCase();
    var name = String(data[i][1] || '').trim();
    var url = String(data[i][2] || '').trim();
    if (!url) continue;
    if (!(url.indexOf('http://') === 0 || url.indexOf('https://') === 0)) continue;
    if (!name) name = url;
    var entry = { name: name, url: url };
    if (kanal === 'facebook_seite' || kanal === 'fb_seite' || kanal === 'facebook-seite') {
      out.facebook_seite.push(entry);
    } else if (
      kanal === 'facebook_gruppe' ||
      kanal === 'facebook_gruppen' ||
      kanal === 'fb_gruppe' ||
      kanal === 'gruppe'
    ) {
      out.facebook_gruppen.push(entry);
    } else if (kanal === 'gbp' || kanal === 'google' || kanal === 'google_business') {
      out.gbp.push(entry);
    }
  }
  return out;
}

/**
 * Legt Tab Kanäle mit Vorlage an. Vorhandene Zeilen mit URL werden nicht überschrieben.
 * @returns {{angelegt:boolean, hinweis:string}}
 */
function dkcInitKanaele() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(DKC_KANAELE_SHEET_NAME_);
  var angelegt = false;

  if (!sh) {
    sh = ss.insertSheet(DKC_KANAELE_SHEET_NAME_);
    angelegt = true;
  }

  if (sh.getLastRow() < 1 || String(sh.getRange(1, 1).getValue() || '').trim() === '') {
    sh.getRange(1, 1, 1, 3).setValues([['Kanal', 'Name', 'URL']]);
    sh.setFrozenRows(1);
  }

  // Vorlage nur wenn außer Kopf nichts Sinnvolles da ist
  var last = sh.getLastRow();
  var hasData = false;
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last, 3).getValues();
    var r;
    for (r = 0; r < vals.length; r++) {
      if (String(vals[r][2] || '').trim() !== '' || String(vals[r][1] || '').trim() !== '') {
        hasData = true;
        break;
      }
    }
  }

  if (!hasData && last <= 1) {
    sh.getRange(2, 1, 8, 3).setValues([
      ['facebook_seite', 'Dorfkino Lögow (Seite)', ''],
      ['facebook_gruppe', 'Gruppe 1 — Name hier', ''],
      ['facebook_gruppe', 'Gruppe 2 — Name hier', ''],
      ['facebook_gruppe', 'Gruppe 3 — Name hier', ''],
      ['facebook_gruppe', 'Gruppe 4 — Name hier', ''],
      ['facebook_gruppe', 'Gruppe 5 — Name hier', ''],
      ['gbp', 'Google Business Profile', ''],
      ['', '← Spalte Kanal: facebook_seite | facebook_gruppe | gbp', '']
    ]);
  }

  try {
    SpreadsheetApp.getUi().alert(
      'Tab „Kanäle"',
      angelegt
        ? 'Tab angelegt. Bitte Name und URL eintragen (facebook_seite, facebook_gruppe, gbp). Danach erscheinen die Links im Gmail-Entwurf.'
        : 'Tab „Kanäle" ist bereit. URLs in Spalte C eintragen bzw. ergänzen.',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    // headless
  }

  return {
    angelegt: angelegt,
    hinweis: 'URLs in Tab Kanäle pflegen'
  };
}

/**
 * HTML-Zeile „Posten:“ mit klickbaren Links für einen Kanalblock.
 * @param {Array<{name:string,url:string}>} entries
 * @returns {string}
 */
function dkcKanaeleLinksHtml_(entries) {
  if (!entries || !entries.length) {
    return (
      '<p style="margin-top:8px;color:#666;font-size:13px;">' +
      '<em>Keine URL — Tab „Kanäle" pflegen (Menü Dorfkino → Kanäle-Tab anlegen).</em></p>'
    );
  }
  var parts = [];
  var i;
  for (i = 0; i < entries.length; i++) {
    var e = entries[i];
    parts.push(
      '<a href="' +
        dkcEscapeAttr_(e.url) +
        '">' +
        dkcEscapeHtml_(e.name) +
        '</a>'
    );
  }
  return (
    '<p style="margin-top:8px;"><strong>Posten:</strong> ' + parts.join(' · ') + '</p>'
  );
}
