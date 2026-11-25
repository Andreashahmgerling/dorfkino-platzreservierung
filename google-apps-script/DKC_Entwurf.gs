/**
 * DKC — Gmail-Entwurf bauen (nur createDraft, kein send).
 */

var DKC_ENTWURF_EMPFAENGER_ = 'info@dorfkinoloegow.de';

/**
 * @param {Object} film
 * @param {Object} texte
 * @param {Array|{fakten:Array}} fakten
 * @returns {string} draftId
 */
function dkcErzeugeEntwurf(film, texte, fakten) {
  film = film || {};
  texte = texte || {};
  var faktenListe = Array.isArray(fakten) ? fakten : (fakten && fakten.fakten) || [];

  var titel = String(film['Titel'] || '').trim() || 'Ohne Titel';
  var datumTtMm = dkcFormatDateTtMm_(film['Date']);
  var subject = '⟶ Entwürfe: ' + titel + ', ' + datumTtMm;

  var kanaele = typeof dkcLeseKanaele === 'function' ? dkcLeseKanaele() : null;
  var html = dkcBaueEntwurfHtml_(film, texte, faktenListe, kanaele);

  var draft = GmailApp.createDraft(DKC_ENTWURF_EMPFAENGER_, subject, '', {
    htmlBody: html
  });

  // GmailApp.Draft#getId
  return draft.getId();
}

/**
 * @private
 */
function dkcBaueEntwurfHtml_(film, texte, faktenListe, kanaele) {
  kanaele = kanaele || { facebook_seite: [], facebook_gruppen: [], gbp: [] };
  var parts = [];
  var poster = film['Poster-URL'] ? String(film['Poster-URL']).trim() : '';
  var backdrop = film['Backdrop-URL'] ? String(film['Backdrop-URL']).trim() : '';
  var bildBlock = dkcBilderBlockHtml_(poster, backdrop);

  var newsletterHtml = texte.newsletter_html || '';
  var reservierungsId = String(film['Reservierungs-ID'] || '').trim();
  var ticketlink = String(film['Ticketlink'] || '').trim();
  if (reservierungsId) {
    var erwarteterLink = 'https://tickets.dorfkinoloegow.de/?film=' + encodeURIComponent(reservierungsId);
    if (ticketlink !== erwarteterLink) {
      throw new Error('Der Ticketlink passt nicht zur Reservierungs-ID. Bitte die Filmzeile zuerst über Kino-Reservierung veröffentlichen / aktualisieren.');
    }
    newsletterHtml += '<p><a href="' + dkcEscapeAttr_(ticketlink) +
      '">Plätze reservieren</a><br>Freie Platzwahl · Bezahlung vor Ort</p>';
  }


  // Oben: beide Motive zum Speichern/Hochladen
  if (bildBlock) {
    parts.push('<h2>Bilder (aus dem Sheet)</h2>');
    parts.push(bildBlock);
    parts.push(
      '<p style="color:#555;font-size:13px;">Tipp: Bild anklicken oder „Datei öffnen“ → speichern unter. ' +
        'Dann bei Facebook/GBP als Foto hochladen. Poster = Hochformat, Backdrop/Banner = Querformat.</p>'
    );
  }

  var blocks = [
    {
      h: 'Newsletter',
      body:
        '<p><strong>' +
        dkcEscapeHtml_(texte.newsletter_betreff || '') +
        '</strong></p>' +
        newsletterHtml,
      count: dkcVisibleLen_(newsletterHtml),
      links: '',
      bilder: false
    },
    {
      h: 'Facebook-Seite',
      body: '<p>' + dkcEscapeHtml_(texte.facebook_seite || '').replace(/\n/g, '<br>') + '</p>',
      count: String(texte.facebook_seite || '').length,
      links: dkcKanaeleLinksHtml_(kanaele.facebook_seite),
      bilder: true
    },
    {
      h: 'Bildzeile',
      body: '<p>' + dkcEscapeHtml_(texte.facebook_bildzeile || '') + '</p>',
      count: String(texte.facebook_bildzeile || '').length,
      // gleiche Seite wie Facebook-Post (Foto + Bildzeile dort)
      links: dkcKanaeleLinksHtml_(kanaele.facebook_seite),
      bilder: true
    },
    {
      h: 'Facebook-Gruppen',
      body: '<p>' + dkcEscapeHtml_(texte.facebook_gruppen || '').replace(/\n/g, '<br>') + '</p>',
      count: String(texte.facebook_gruppen || '').length,
      links: dkcKanaeleLinksHtml_(kanaele.facebook_gruppen),
      bilder: true
    },
    {
      h: 'Google Business Profile',
      body: '<p>' + dkcEscapeHtml_(texte.gbp_post || '').replace(/\n/g, '<br>') + '</p>',
      count: String(texte.gbp_post || '').length,
      links: dkcKanaeleLinksHtml_(kanaele.gbp),
      bilder: true
    }
  ];

  var i;
  for (i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    parts.push('<h2>' + dkcEscapeHtml_(b.h) + '</h2>');
    parts.push(b.body);
    parts.push('<p><em>Zeichen: ' + b.count + '</em></p>');
    if (b.bilder && bildBlock) {
      parts.push(
        '<p style="margin:6px 0 0;font-size:13px;"><strong>Bild mitnehmen:</strong> ' +
          dkcBildLinksKurz_(poster, backdrop) +
          '</p>'
      );
    }
    if (b.links) parts.push(b.links);
  }

  parts.push('<h2>Quellen</h2>');
  if (!faktenListe.length) {
    parts.push('<p>Keine belegten Zusatzfakten.</p>');
  } else {
    parts.push('<ul>');
    for (i = 0; i < faktenListe.length; i++) {
      var f = faktenListe[i] || {};
      var q = String(f.quelle || '');
      var a = String(f.aussage || '');
      parts.push(
        '<li><a href="' + dkcEscapeAttr_(q) + '">' + dkcEscapeHtml_(a) + '</a></li>'
      );
    }
    parts.push('</ul>');
  }

  return parts.join('\n');
}

/**
 * Date → TT.MM. (ohne Jahr). Akzeptiert Date-Objekt, dd.MM.yyyy, yyyy-MM-dd.
 * @private
 */
function dkcFormatDateTtMm_(v) {
  if (v === null || v === undefined || v === '') return '??.??.';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, 'Europe/Berlin', 'dd.MM.');
  }
  var s = String(v).trim();
  var m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/);
  if (m) {
    return dkcPad2_(m[1]) + '.' + dkcPad2_(m[2]) + '.';
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return m[3] + '.' + m[2] + '.';
  }
  // already TT.MM. or fallback
  m = s.match(/(\d{1,2})\.(\d{1,2})\./);
  if (m) return dkcPad2_(m[1]) + '.' + dkcPad2_(m[2]) + '.';
  return s;
}

/** @private */
function dkcPad2_(n) {
  var s = String(n);
  return s.length === 1 ? '0' + s : s;
}

/** @private */
function dkcVisibleLen_(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .length;
}

/** @private */
function dkcEscapeHtml_(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** @private */
function dkcEscapeAttr_(s) {
  return dkcEscapeHtml_(s).replace(/'/g, '&#39;');
}

/**
 * Poster + Backdrop: Vorschau und Direktlinks (TMDB-URLs aus dem Sheet).
 * @private
 */
function dkcBilderBlockHtml_(poster, backdrop) {
  if (!poster && !backdrop) return '';
  var parts = ['<table cellpadding="8" cellspacing="0" style="border-collapse:collapse;"><tr>'];

  if (poster) {
    parts.push(
      '<td style="vertical-align:top;border:1px solid #ddd;padding:10px;">' +
        '<div style="font-weight:bold;margin-bottom:6px;">Poster (Hochformat)</div>' +
        '<a href="' +
        dkcEscapeAttr_(poster) +
        '"><img src="' +
        dkcEscapeAttr_(poster) +
        '" alt="Poster" width="200" style="display:block;max-width:200px;"></a>' +
        '<p style="margin:8px 0 0;font-size:13px;">' +
        '<a href="' +
        dkcEscapeAttr_(poster) +
        '">Poster-Datei öffnen</a></p></td>'
    );
  }

  if (backdrop) {
    parts.push(
      '<td style="vertical-align:top;border:1px solid #ddd;padding:10px;">' +
        '<div style="font-weight:bold;margin-bottom:6px;">Backdrop / Banner (Querformat)</div>' +
        '<a href="' +
        dkcEscapeAttr_(backdrop) +
        '"><img src="' +
        dkcEscapeAttr_(backdrop) +
        '" alt="Backdrop" width="320" style="display:block;max-width:320px;"></a>' +
        '<p style="margin:8px 0 0;font-size:13px;">' +
        '<a href="' +
        dkcEscapeAttr_(backdrop) +
        '">Banner-Datei öffnen</a></p></td>'
    );
  }

  parts.push('</tr></table>');
  return parts.join('');
}

/**
 * Kurze Linkzeile unter Post-Blöcken.
 * @private
 */
function dkcBildLinksKurz_(poster, backdrop) {
  var bits = [];
  if (poster) {
    bits.push('<a href="' + dkcEscapeAttr_(poster) + '">Poster</a>');
  }
  if (backdrop) {
    bits.push('<a href="' + dkcEscapeAttr_(backdrop) + '">Banner</a>');
  }
  if (!bits.length) return '—';
  return bits.join(' · ');
}
