/**
 * DKC — Kanaltexte erzeugen (Call 2).
 */

var DKC_TEXT_KEYS_ = [
  'newsletter_betreff',
  'newsletter_kurztitel',
  'newsletter_html',
  'facebook_seite',
  'facebook_bildzeile',
  'facebook_gruppen',
  'gbp_post'
];

/** Betreff: Stichwort. Titel, Wo., TT.MM., Uhrzeit(en) h */
var DKC_BETREFF_RE_ = /^.+\.\s+.+\,\s*[A-Za-zÄÖÜäöü.]{2,5}\.?\s*,\s*\d{1,2}\.\d{1,2}\.\s*,\s*.+\s+h\s*$/;

var DKC_ICH_RE_ = /\bich\b/i;

/**
 * Humanizer-Regeln (nach dem Skill „humanizer", Wunsch von Andreas 2026-11-25).
 * Fest im Code, damit sie unabhängig vom Prompts-Tab bei JEDER Generierung gelten.
 */
var DKC_HUMANIZER_REGELN_ =
  'HUMANIZER (gilt für alle Ausgabefelder, hat Vorrang vor Stilgewohnheiten):\n' +
  'Schreib wie Andreas, nicht wie ein Chatbot. Jeder Satz muss etwas Neues bringen. Fakten, Namen, Zahlen, Termine und Zitate bleiben unverändert.\n' +
  'Vermeide:\n' +
  '- „nicht X, sondern Y", „nicht nur … sondern auch", „X statt Y" als bloße Gewichtung. Sag direkt, was ist.\n' +
  '- Ein-Satz-Absätze, die das Vorige wiederholen; Schlusssätze wie „Das zählt." oder „Mehr muss man nicht sagen."; Reihen von Satzfragmenten; Wörter in VERSALIEN.\n' +
  '- Pseudotiefe: „im Kern", „worum es wirklich geht", „die eigentliche Frage", Aphorismen der Form „X ist die Sprache von Y".\n' +
  '- Anlauf vor dem Punkt: „Hand aufs Herz", „Ehrlich?", „Mal ehrlich", „Das Besondere daran:", „Hier kommt der Clou".\n' +
  '- Einwände, die niemand erhoben hat („Man könnte meinen …").\n' +
  '- Erzwungene Dreierreihen (drei Adjektive, drei parallele Beispiele), wenn der Inhalt keine drei Teile hat.\n' +
  '- Mehrere Sätze hintereinander mit demselben Anfang.\n' +
  '- Gedankenstriche (— oder –) im Ausgabetext; stattdessen Punkt, Komma, Doppelpunkt oder Klammer. Bindestriche in Komposita und Zeitangaben bleiben.\n' +
  '- Gestapelte Abschwächungen („könnte möglicherweise").\n' +
  '- Aufgeblasene Bedeutung und Werbesprache: „ein Meilenstein", „prägt nachhaltig", „ein Muss", „atemberaubend", „bahnbrechend", „eindrucksvoll", „meisterhaft", „beeindruckend", „zeugt von", „unterstreicht", „setzt Maßstäbe", „ein Fest für die Sinne".\n' +
  '- Geliehene Autorität ohne Namen: „Kritiker loben", „Experten sagen", „vielfach gefeiert". Zitate nur mit Quelle.\n' +
  '- Ausweichen vor „ist/hat": „fungiert als", „stellt dar", „präsentiert sich als", „besticht durch", „wartet auf mit".\n' +
  '- Fett als Dekoration, Überschriften, die der erste Satz wiederholt.\n' +
  '- Chatbot-Reste und Wissensvorbehalte: „Viel Spaß!", „Lassen Sie sich überraschen", „nach verfügbaren Informationen".\n' +
  'Prüfe vor der Ausgabe jedes Feld noch einmal auf diese Muster, besonders Kontraste, Schlusssätze, Dreierreihen und Gedankenstriche, und schreib betroffene Sätze neu. Satzlängen variieren. Deutsche Anführungszeichen „…" bleiben.';

/**
 * @param {Object} film
 * @param {Array|{fakten:Array}} fakten
 * @param {Object} prompts
 * @returns {Object}
 */
function dkcSchreibeTexte(film, fakten, prompts) {
  film = film || {};
  prompts = prompts || {};

  var faktenListe = Array.isArray(fakten) ? fakten : (fakten && fakten.fakten) || [];
  var kommentar = film['Kommentar'];
  kommentar = kommentar === null || kommentar === undefined ? '' : String(kommentar).trim();

  var systemParts = [
    prompts.allgemein || '',
    prompts.newsletter || '',
    prompts.facebook_seite || '',
    prompts.facebook_bildzeile || '',
    prompts.facebook_gruppen || '',
    prompts.gbp || ''
  ];
  systemParts.push(DKC_HUMANIZER_REGELN_);
  var system = systemParts.join('\n\n---\n\n');

  var termin = dkcBaueTermin_(film);

  var userObj = {
    film: film,
    termin: termin,
    fakten: faktenListe,
    kommentar: kommentar,
    detailseiten_url: dkcDetailseitenUrl_(film)
  };

  var terminRegel =
    'TERMIN-PFLICHT (hart, keine Ausnahme):\n' +
    '- Datum, Wochentag und Uhrzeiten kommen NUR aus dem Objekt „termin" bzw. film.Date / film.Wochentag / film["Start time"] / film["2nd start"].\n' +
    '- Erlaubte Uhrzeiten exakt: ' +
    (termin.uhrzeiten.length ? termin.uhrzeiten.join(', ') : '(keine — dann keine Uhrzeit erfinden)') +
    '.\n' +
    '- Erfinde KEINE andere Uhrzeit (nicht 20:00, nicht 19:00, nicht „abends" als Ersatzzahl).\n' +
    '- Alle Kanäle und der Betreff müssen dieselben Uhrzeiten tragen.\n' +
    '- Zweite Vorstellung nur wenn termin.uhrzeiten einen zweiten Eintrag hat.\n' +
    '- Beispiel-Termin im Stilprofil ist NUR Format — keine Vorlage für konkrete Zeiten.\n';

  var parsed;
  try {
    parsed = dkcRufeClaude({
      system: system,
      messages: [
        {
          role: 'user',
          content:
            terminRegel +
            '\nErzeuge die sechs Textfelder als JSON-Objekt mit genau diesen Schlüsseln: ' +
            DKC_TEXT_KEYS_.join(', ') +
            '. Nur JSON.\n\n' +
            JSON.stringify(userObj)
        }
      ],
      maxTokens: 40000,
      ausgabeSchema: dkcTexteSchema_()
    });
  } catch (e) {
    throw new Error('Texte: ' + (e && e.message ? e.message : String(e)));
  }

  var texte = dkcPruefeTexte_(parsed, kommentar);
  texte.newsletter_html = dkcGlaetteZwischentitel_(texte.newsletter_html, kommentar);
  // Betreff fest gebaut: „Kurztitel – So., 15.11., 17:00 und 19:30 h"
  texte.newsletter_betreff = dkcBaueBetreff_(texte.newsletter_kurztitel, termin);
  dkcPruefeTermineInTexten_(texte, termin);
  return texte;
}

/**
 * Baut strukturierten Termin aus Sheet-Spalten (keine Modell-Erfindung).
 * @returns {{wochentag:string, datum:string, uhrzeiten:string[], uhrzeiten_text:string}}
 */
function dkcBaueTermin_(film) {
  film = film || {};
  var start = String(film['Start time'] || '').trim();
  var second = String(film['2nd start'] || '').trim();
  var uhrzeiten = [];
  if (start) uhrzeiten.push(start);
  if (second && second !== start) uhrzeiten.push(second);
  return {
    wochentag: String(film['Wochentag'] || '').trim(),
    datum: String(film['Date'] || '').trim(),
    uhrzeiten: uhrzeiten,
    uhrzeiten_text: uhrzeiten.join(' und ')
  };
}

/**
 * Jede Sheet-Uhrzeit muss in Betreff + Kernkanälen vorkommen; erfundene Zeiten fallen auf.
 * @private
 */
function dkcPruefeTermineInTexten_(texte, termin) {
  var times = (termin && termin.uhrzeiten) || [];
  if (!times.length) return;

  var blob = [
    texte.newsletter_betreff || '',
    texte.newsletter_html || '',
    texte.facebook_seite || '',
    texte.facebook_gruppen || '',
    texte.gbp_post || ''
  ].join('\n');

  var i;
  for (i = 0; i < times.length; i++) {
    if (!dkcTextEnthaeltUhrzeit_(blob, times[i])) {
      throw new Error(
        'Texte: Uhrzeit aus dem Sheet fehlt in den Ausgaben: ' +
          times[i] +
          ' (erlaubt nur: ' +
          times.join(', ') +
          '). Bitte erneut erzeugen.'
      );
    }
  }
}

/**
 * Erkennt 17:00, 17 Uhr, 17/19:30, 17.00 o. ä.
 * @private
 */
function dkcTextEnthaeltUhrzeit_(text, uhr) {
  var m = String(uhr || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return String(text).indexOf(String(uhr)) !== -1;
  var h = String(parseInt(m[1], 10)); // ohne führende Null
  var h2 = m[1].length === 1 ? '0' + m[1] : m[1];
  var min = m[2];
  var t = String(text);
  var patterns = [
    h + ':' + min,
    h2 + ':' + min,
    h + '.' + min,
    h2 + '.' + min,
    h + ' Uhr',
    h2 + ' Uhr',
    h + '/' , // 17/19:30 im Betreff
    h2 + '/'
  ];
  // volle Zeit oder Stunde vor / bei Doppelvorstellung
  var i;
  for (i = 0; i < patterns.length; i++) {
    if (t.indexOf(patterns[i]) !== -1) {
      // bei nur "17/" zusätzlich Minuten der ersten Zeit ok; bei :00 auch "17 h" am Ende
      if (patterns[i].slice(-1) === '/' && min !== '00') {
        // Stunde allein im Betreff-Schema 17/19:30 — ok für volle Stunde und mit Minuten-Partner
        return true;
      }
      return true;
    }
  }
  // „17 h" / „17h" wenn Minuten 00
  if (min === '00') {
    var re = new RegExp('\\b' + h + '\\s*h\\b', 'i');
    if (re.test(t)) return true;
  }
  return false;
}

/**
 * Validiert Textpaket (auch für Tests).
 * @param {Object} texte
 * @param {string} kommentar
 * @returns {Object}
 */
function dkcPruefeTexte_(texte, kommentar) {
  if (!texte || typeof texte !== 'object') {
    throw new Error('Texte: Antwort ist kein Objekt.');
  }

  var out = {};
  var i;
  for (i = 0; i < DKC_TEXT_KEYS_.length; i++) {
    var k = DKC_TEXT_KEYS_[i];
    if (!Object.prototype.hasOwnProperty.call(texte, k)) {
      throw new Error('Texte: Feld fehlt: ' + k);
    }
    var v = texte[k];
    if (v === null || v === undefined || String(v).trim() === '') {
      throw new Error('Texte: Feld leer: ' + k);
    }
    out[k] = String(v);
  }


  if (out.facebook_bildzeile.length > 120) {
    throw new Error('Texte: Feld facebook_bildzeile länger als 120 Zeichen.');
  }
  if (out.gbp_post.length > 1500) {
    throw new Error('Texte: Feld gbp_post länger als 1500 Zeichen.');
  }

  var kommentarLeer = !kommentar || String(kommentar).trim() === '';
  if (kommentarLeer) {
    for (i = 0; i < DKC_TEXT_KEYS_.length; i++) {
      var key = DKC_TEXT_KEYS_[i];
      if (DKC_ICH_RE_.test(out[key])) {
        throw new Error('Texte: Feld ' + key + ' enthält „ich" bei leerem Kommentar.');
      }
    }
  }

  return out;
}

/**
 * Film-Detailseite wie WordPress-Plugin „Dorfkino Programm":
 * slug = sanitize_title( Titel + '-' + YYYY-MM-DD )
 * URL  = https://dorfkinoloegow.de/film/{slug}/
 * Datum-Normalisierung wie DPR_Sync::normalize_date (date hide → Date → Release-Date).
 * @private
 */
function dkcDetailseitenUrl_(film) {
  film = film || {};
  var title = String(film['Titel'] || '').trim();
  var dateNorm = dkcNormalizeDateYmd_(film);
  if (!title || !dateNorm) {
    return 'https://dorfkinoloegow.de/';
  }
  var slug = dkcWpSanitizeTitle_(title + '-' + dateNorm);
  if (!slug) return 'https://dorfkinoloegow.de/';
  return 'https://dorfkinoloegow.de/film/' + slug + '/';
}

/**
 * Wie Plugin: date hide | Date | Release-Date → YYYY-MM-DD.
 * @private
 */
function dkcNormalizeDateYmd_(film) {
  var candidates = [
    film['date hide'],
    film['Date'],
    film['Release-Date']
  ];
  var i;
  for (i = 0; i < candidates.length; i++) {
    var raw = String(candidates[i] == null ? '' : candidates[i]).trim();
    if (!raw) continue;
    var m;
    // 2026.05.17
    m = raw.match(/^(\d{4})\.(\d{2})\.(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    // 17.05.2026
    m = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (m) {
      return m[3] + '-' + dkcPad2_(m[2]) + '-' + dkcPad2_(m[1]);
    }
    // 2026-05-17
    m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
  }
  return '';
}

/**
 * Annäherung an WP sanitize_title + deutsche Umlaute (ä→ae …),
 * wie live auf dorfkinoloegow.de (juengste, heisse, kaengurus).
 * @private
 */
function dkcWpSanitizeTitle_(s) {
  s = String(s || '').toLowerCase();
  var map = {
    ä: 'ae',
    ö: 'oe',
    ü: 'ue',
    ß: 'ss',
    à: 'a',
    á: 'a',
    â: 'a',
    ã: 'a',
    å: 'a',
    æ: 'ae',
    ç: 'c',
    è: 'e',
    é: 'e',
    ê: 'e',
    ë: 'e',
    ì: 'i',
    í: 'i',
    î: 'i',
    ï: 'i',
    ñ: 'n',
    ò: 'o',
    ó: 'o',
    ô: 'o',
    õ: 'o',
    ø: 'o',
    ù: 'u',
    ú: 'u',
    û: 'u',
    ý: 'y',
    ÿ: 'y',
    œ: 'oe'
  };
  var out = '';
  var i;
  for (i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    if (map[ch]) {
      out += map[ch];
      continue;
    }
    var code = s.charCodeAt(i);
    // strip combining marks if any slipped in
    if (code >= 0x0300 && code <= 0x036f) continue;
    out += ch;
  }
  out = out.replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return out;
}

/** @private */
function dkcPad2_(n) {
  var s = String(n);
  return s.length === 1 ? '0' + s : s;
}

/** JSON-Schema für die sechs Kanaltexte (strukturierte Ausgabe). @private */
function dkcTexteSchema_() {
  var props = {};
  for (var i = 0; i < DKC_TEXT_KEYS_.length; i++) {
    props[DKC_TEXT_KEYS_[i]] = { type: 'string' };
  }
  props.newsletter_kurztitel.description =
    'Wertendes Stichwort plus Filmtitel für den Betreff, z. B. „Berlinale-Gewinner Gelbe Briefe". Stichwort = stärkster Aufhänger (Preis, Regie, Thema). Ohne Datum, ohne Satzzeichen am Ende.';
  props.newsletter_html.description = 'Newsletter-Fließtext als HTML (<p>, <a>, <br>).';
  return { type: 'object', properties: props, required: DKC_TEXT_KEYS_.slice() };
}

var DKC_WOTAG_KURZ_ = {
  montag: 'Mo.', dienstag: 'Di.', mittwoch: 'Mi.', donnerstag: 'Do.',
  freitag: 'Fr.', samstag: 'Sa.', sonnabend: 'Sa.', sonntag: 'So.'
};

/** Betreff „Kurztitel – So., 15.11., 17:00 und 19:30 h". @private */
function dkcBaueBetreff_(kurztitel, termin) {
  termin = termin || {};
  var kurz = String(kurztitel || '').trim().replace(/[.,;:–-]+$/, '');
  var teile = [];
  var wt = String(termin.wochentag || '').trim();
  var wtKey = wt.toLowerCase().replace(/\.$/, '');
  if (wt) teile.push(DKC_WOTAG_KURZ_[wtKey] || (wt.slice(-1) === '.' ? wt : wt + '.'));
  if (termin.datum) teile.push(dkcFormatDateTtMm_(termin.datum));
  if (termin.uhrzeiten && termin.uhrzeiten.length) teile.push(termin.uhrzeiten.join(' und ') + ' h');
  return kurz + (teile.length ? ' – ' + teile.join(', ') : '');
}

/**
 * Zwischenüberschriften (h1–h6) aus dem Newsletter entfernen.
 * Die letzte wird – nur wenn ein Kommentar vorliegt – zu <p><strong>Meinung</strong></p>.
 * @private
 */
function dkcGlaetteZwischentitel_(html, kommentar) {
  var s = String(html || '');
  var re = /<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>\s*/gi;
  var treffer = s.match(re) || [];
  if (!treffer.length) return s;
  var mitMeinung = !!(kommentar && String(kommentar).trim());
  var n = 0;
  return s.replace(re, function () {
    n++;
    if (n === treffer.length && mitMeinung) return '<p><strong>Meinung</strong></p>\n';
    return '';
  });
}
