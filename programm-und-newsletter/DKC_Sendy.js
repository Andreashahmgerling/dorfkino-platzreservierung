/**
 * DKC — Newsletter-Entwurf als Sendy-Kampagne anlegen (nur Entwurf, kein Versand).
 *
 * Struktur nach Vorlage Kampagne 31 ("Alle hassen Johan"):
 *   Newsletter-Text (inkl. Termin, Detail-Link, Grüße)
 *   → "Plätze reservieren" + Freie Platzwahl · Bezahlung <Eintritt> vor Ort
 *   → Poster/Banner-Tabelle mit Dateilinks
 *   → Signatur Dorfkino Lögow
 *   → <unsubscribe>abbestellen</unsubscribe>
 *
 * Script Properties:
 *   SENDY_URL       (Default https://sendy.example.org)
 *   SENDY_API_KEY   (Pflicht — Sendy → Einstellungen → API key)
 *   SENDY_BRAND_ID  (Default 1 = Dorfkino Lögow)
 *   DKC_EINTRITT    (Default "9 €")
 */

var DKC_SENDY_DEFAULTS_ = {
  url: 'https://sendy.example.org',
  brandId: '1',
  fromName: 'Dorfkino Lögow',
  fromEmail: 'info@dorfkinoloegow.de',
  replyTo: 'info@dorfkinoloegow.de',
  eintritt: '9 €'
};

/** @private */
function dkcSendyConfig_() {
  var p = PropertiesService.getScriptProperties();
  var key = String(p.getProperty('SENDY_API_KEY') || '').trim();
  if (!key) throw new Error('SENDY_API_KEY fehlt in den Script Properties');
  return {
    url: String(p.getProperty('SENDY_URL') || DKC_SENDY_DEFAULTS_.url).trim().replace(/\/+$/, ''),
    apiKey: key,
    brandId: String(p.getProperty('SENDY_BRAND_ID') || DKC_SENDY_DEFAULTS_.brandId).trim(),
    eintritt: String(p.getProperty('DKC_EINTRITT') || DKC_SENDY_DEFAULTS_.eintritt).trim()
  };
}

/**
 * Legt eine Entwurfs-Kampagne in Sendy an.
 * @param {Object} film
 * @param {Object} texte  (newsletter_betreff, newsletter_html)
 * @returns {string} Sendy-Antwort ("Campaign created")
 */
function dkcErzeugeSendyKampagne(film, texte) {
  film = film || {};
  texte = texte || {};
  var cfg = dkcSendyConfig_();

  var titel = String(film['Titel'] || '').trim() || 'Ohne Titel';
  var betreff = String(texte.newsletter_betreff || '').trim() || titel;
  var html = dkcBaueSendyHtml_(film, texte, cfg.eintritt);

  var resp = UrlFetchApp.fetch(cfg.url + '/api/campaigns/create.php', {
    method: 'post',
    muteHttpExceptions: true,
    payload: {
      api_key: cfg.apiKey,
      brand_id: cfg.brandId,
      from_name: DKC_SENDY_DEFAULTS_.fromName,
      from_email: DKC_SENDY_DEFAULTS_.fromEmail,
      reply_to: DKC_SENDY_DEFAULTS_.replyTo,
      title: titel,
      subject: betreff,
      html_text: html,
      plain_text: dkcSendyPlain_(html),
      send_campaign: '0' // nur Entwurf
    }
  });

  var body = String(resp.getContentText() || '').trim();
  if (resp.getResponseCode() !== 200 || !/campaign created/i.test(body)) {
    throw new Error('Sendy: ' + dkcSanitizeApiError_(body, cfg.apiKey));
  }
  return body;
}

/** @private */
function dkcBaueSendyHtml_(film, texte, eintritt) {
  var parts = ['<html><head><title></title></head><body style="box-sizing: border-box; margin: 0;">'];
  var newsletterHtml = String(texte.newsletter_html || '');
  parts.push(newsletterHtml);

  if (!/Gr(ü|&uuml;)(ß|&szlig;)e/i.test(dkcStripTags_(newsletterHtml))) {
    parts.push('<p>Herzliche Grüße,<br />\nAndreas Hahm-Gerling</p>');
  }

  var ticketlink = String(film['Ticketlink'] || '').trim();
  if (ticketlink) {
    parts.push(
      '<p><a href="' + dkcEscapeAttr_(ticketlink) + '" target="_blank">Plätze reservieren</a><br />\n' +
        'Freie Platzwahl · Bezahlung ' + dkcEscapeHtml_(eintritt) + ' vor Ort</p>'
    );
  }

  var poster = String(film['Poster-URL'] || '').trim();
  var backdrop = String(film['Backdrop-URL'] || '').trim();
  if (poster || backdrop) {
    parts.push('<table cellpadding="8" cellspacing="0"><tbody><tr>');
    if (poster) parts.push(dkcSendyBildZelle_(poster, 'Poster', 200, 'Poster-Datei öffnen'));
    if (backdrop) parts.push(dkcSendyBildZelle_(backdrop, 'Backdrop', 320, 'Banner-Datei öffnen'));
    parts.push('</tr></tbody></table>');
  }

  parts.push(
    '<p><br />\nDorfkino Lögow<br />\nDas kleinste Kino. Verbindet<br />\n' +
      'Schulstr. 2, 16845 Lögow<br />\n01735395237<br />\nwww.dorfkinoloegow.de</p>'
  );
  parts.push('<p><unsubscribe>abbestellen</unsubscribe></p>');
  parts.push('</body></html>');
  return parts.join('\n');
}

/** @private */
function dkcSendyBildZelle_(url, alt, breite, linktext) {
  var u = dkcEscapeAttr_(url);
  return (
    '<td><a href="' + u + '" target="_blank"><img alt="' + alt + '" src="' + u + '" width="' + breite + '" /></a>' +
    '<p><a href="' + u + '" target="_blank">' + linktext + '</a></p></td>'
  );
}

/** @private */
function dkcStripTags_(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ');
}

/** @private */
function dkcSendyPlain_(html) {
  return String(html || '')
    .replace(/<unsubscribe>[\s\S]*?<\/unsubscribe>/gi, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2: $1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
