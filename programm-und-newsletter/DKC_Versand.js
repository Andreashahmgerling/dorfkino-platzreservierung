/**
 * DKC — Phase 3: Newsletter-Einzelversand aus VL_all.
 * Kein BCC. Nur status=active. Abmelde-Link pro Empfänger (Web-App doGet).
 */

var DKC_VL_SHEET_ = 'VL_all';
var DKC_SENT_SHEET_ = 'DKC_Sent';
var DKC_FROM_ALIAS_ = 'info@dorfkinoloegow.de';
var DKC_DRAFT_SUBJECT_PREFIX_ = '⟶ Entwürfe:';
/** 1 Empfänger Reserve, damit die Quota-Prüfung nicht auf 0 knallt. */
var DKC_QUOTA_RESERVE_ = 1;

/**
 * Empfänger aus VL_all.
 * @returns {{
 *   empfaenger: Array<{email:string,name:string}>,
 *   aktiv: number,
 *   aussortiert: number,
 *   gruende: Object
 * }}
 */
function dkcLeseEmpfaenger() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(DKC_VL_SHEET_);
  if (!sh) {
    throw new Error('Tab „' + DKC_VL_SHEET_ + '“ fehlt.');
  }

  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2) {
    return { empfaenger: [], aktiv: 0, aussortiert: 0, gruende: { leer: 0 } };
  }

  var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) {
    return String(h || '').trim();
  });
  var idx = {
    email: dkcHeaderIndex_(headers, ['Subscriber', 'E-Mail', 'Email', 'email']),
    name: dkcHeaderIndex_(headers, ['Name']),
    last: dkcHeaderIndex_(headers, ['Last name', 'Nachname']),
    status: dkcHeaderIndex_(headers, ['status', 'Status']),
    optin: dkcHeaderIndex_(headers, ['double optin', 'Double optin', 'double_optin'])
  };
  if (idx.email < 0 || idx.status < 0) {
    throw new Error('VL_all: Spalten Subscriber und status erforderlich.');
  }

  var gruende = {
    not_active: 0,
    optin: 0,
    invalid: 0,
    duplikat: 0
  };
  var seen = {};
  var list = [];
  var r;
  for (r = 1; r < values.length; r++) {
    var row = values[r];
    var email = String(row[idx.email] || '')
      .trim()
      .toLowerCase();
    var status = String(row[idx.status] || '')
      .trim()
      .toLowerCase();
    var optin =
      idx.optin >= 0
        ? String(row[idx.optin] || '')
            .trim()
            .toLowerCase()
        : 'confirmed';

    if (!email) {
      gruende.invalid++;
      continue;
    }
    if (status !== 'active') {
      gruende.not_active++;
      continue;
    }
    // confirmed oder leer (Legacy); unconfirmed raus
    if (optin && optin !== 'confirmed') {
      gruende.optin++;
      continue;
    }
    if (!dkcEmailOk_(email)) {
      gruende.invalid++;
      continue;
    }
    if (seen[email]) {
      gruende.duplikat++;
      continue;
    }
    seen[email] = true;

    var vor = idx.name >= 0 ? String(row[idx.name] || '').trim() : '';
    var nach = idx.last >= 0 ? String(row[idx.last] || '').trim() : '';
    var name = (vor + ' ' + nach).trim();
    list.push({ email: email, name: name });
  }

  var aussortiert =
    gruende.not_active + gruende.optin + gruende.invalid + gruende.duplikat;
  return {
    empfaenger: list,
    aktiv: list.length,
    aussortiert: aussortiert,
    gruende: gruende
  };
}

/**
 * Menü: Empfängerzahl anzeigen.
 */
function dkcMenuEmpfaengerZaehlen() {
  var ui = SpreadsheetApp.getUi();
  try {
    var r = dkcLeseEmpfaenger();
    var quotaTxt = dkcQuotaHinweis_();
    ui.alert(
      'Verteiler VL_all',
      'Aktiv (versandbereit): ' +
        r.aktiv +
        '\nAussortiert: ' +
        r.aussortiert +
        '\n  nicht active: ' +
        r.gruende.not_active +
        '\n  opt-in: ' +
        r.gruende.optin +
        '\n  ungültig: ' +
        r.gruende.invalid +
        '\n  Duplikat: ' +
        r.gruende.duplikat +
        quotaTxt,
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert('Fehler', e.message || String(e), ui.ButtonSet.OK);
  }
}

/**
 * Trockenlauf — sendet nichts.
 */
function dkcMenuVersandTrockenlauf() {
  dkcVersandeUi_({ trockenlauf: true });
}

/**
 * Test: nur an die Adresse des ausführenden Kontos.
 */
function dkcMenuVersandTestAnMich() {
  var me = Session.getActiveUser().getEmail();
  if (!me) {
    SpreadsheetApp.getUi().alert('Keine Benutzer-E-Mail ermittelbar.');
    return;
  }
  dkcVersandeUi_({ trockenlauf: false, testNurAn: [me] });
}

/**
 * Echtversand: eine Charge bis zum Tageskontingent, fortsetzbar (Tab DKC_Sent).
 */
function dkcMenuVersandEcht() {
  var ui = SpreadsheetApp.getUi();
  try {
    var pack = dkcLadeEntwurfInhalt_(null);
    var campaignId = dkcCampaignId_(pack.subject);
    var r = dkcLeseEmpfaengerFuerKampagne_(campaignId);
    var q = dkcGetQuotaSafe_();
    var maxHeute = Math.max(0, q - DKC_QUOTA_RESERVE_);
    var dieseCharge = Math.min(r.offen, maxHeute);

    if (r.offen === 0) {
      ui.alert(
        'Nichts zu senden',
        'Für diese Kampagne („' +
          pack.subject +
          '“) sind alle ' +
          r.aktiv +
          ' active-Adressen bereits in DKC_Sent.\n\nNeuer Entwurf/Betreff = neue Kampagne.',
        ui.ButtonSet.OK
      );
      return;
    }
    if (dieseCharge < 1) {
      ui.alert(
        'Kontingent leer',
        'Offen: ' +
          r.offen +
          ' · Tageskontingent: ' +
          q +
          '.\n\n' +
          dkcQuotaErklaerung_() +
          '\n\nMorgen „Charge senden“ erneut — der Stand steckt in Tab DKC_Sent.',
        ui.ButtonSet.OK
      );
      return;
    }

    var a1 = ui.alert(
      'Charge senden?',
      'Kampagne: ' +
        pack.subject +
        '\n\nActive gesamt: ' +
        r.aktiv +
        '\nBereits gesendet (diese Kampagne): ' +
        r.schon +
        '\nNoch offen: ' +
        r.offen +
        '\nTageskontingent jetzt: ' +
        q +
        '\nDiese Charge: ' +
        dieseCharge +
        ' Einzelmails (kein BCC)' +
        (dieseCharge < r.offen
          ? '\n\nRest (' + (r.offen - dieseCharge) + ') → an späteren Tagen mit demselben Entwurf fortsetzen.'
          : '') +
        '\n\n' +
        (q <= 100 ? dkcQuotaErklaerung_() + '\n\n' : '') +
        'Weiter zur Bestätigung?',
      ui.ButtonSet.YES_NO
    );
    if (a1 !== ui.Button.YES) return;

    var a2 = ui.alert(
      'Letzte Bestätigung',
      'WIRKLICH ' + dieseCharge + ' Mails senden?',
      ui.ButtonSet.YES_NO
    );
    if (a2 !== ui.Button.YES) return;

    dkcVersandeUi_({
      trockenlauf: false,
      campaignId: campaignId,
      maxSenden: dieseCharge
    });
  } catch (e) {
    ui.alert('Abbruch', e.message || String(e), ui.ButtonSet.OK);
  }
}

/**
 * @param {{trockenlauf:boolean, draftId?:string, testNurAn?:string[]}} opts
 */
function dkcVersandeUi_(opts) {
  var ui = SpreadsheetApp.getUi();
  try {
    var result = dkcVersendeNewsletter(opts);
    ui.alert(
      opts.trockenlauf ? 'Trockenlauf' : 'Versand',
      result.meldung,
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert('Abbruch', e.message || String(e), ui.ButtonSet.OK);
  }
}

/**
 * @param {{trockenlauf?:boolean, draftId?:string, testNurAn?:string[], campaignId?:string, maxSenden?:number}} opts
 * @returns {{gesendet:number, fehler:number, meldung:string, protokoll:string[]}}
 */
function dkcVersendeNewsletter(opts) {
  opts = opts || {};
  var trockenlauf = !!opts.trockenlauf;

  var pack = dkcLadeEntwurfInhalt_(opts.draftId);
  var campaignId = opts.campaignId || dkcCampaignId_(pack.subject);
  var liste = dkcLeseEmpfaenger();
  var empfaenger = liste.empfaenger;

  if (opts.testNurAn && opts.testNurAn.length) {
    empfaenger = opts.testNurAn.map(function (e) {
      return { email: String(e).trim().toLowerCase(), name: '' };
    });
  } else if (!trockenlauf) {
    empfaenger = dkcFilterNochNichtGesendet_(empfaenger, campaignId);
  }

  if (!empfaenger.length) {
    throw new Error(
      trockenlauf
        ? 'Keine Empfänger (VL_all status=active).'
        : 'Keine offenen Empfänger für diese Kampagne (alle in DKC_Sent oder Liste leer).'
    );
  }

  var geplant = empfaenger.length;
  if (!trockenlauf) {
    var quota = dkcGetQuotaSafe_();
    var maxByQuota = Math.max(0, quota - DKC_QUOTA_RESERVE_);
    var maxSenden =
      opts.maxSenden != null ? Math.min(opts.maxSenden, maxByQuota) : maxByQuota;
    if (maxSenden < 1) {
      throw new Error(
        'Tageskontingent zu klein (' +
          quota +
          '). ' +
          dkcQuotaErklaerung_() +
          ' Keine Mail gesendet.'
      );
    }
    if (empfaenger.length > maxSenden) {
      empfaenger = empfaenger.slice(0, maxSenden);
    }
  }

  var webAppUrl = dkcGetWebAppUrl_();
  var protokoll = [];
  var gesendet = 0;
  var fehler = 0;
  var maxTrocken = 3;
  var i;

  for (i = 0; i < empfaenger.length; i++) {
    var em = empfaenger[i];
    var unsub = dkcBaueAbmeldeUrl_(em.email, webAppUrl);
    var html = dkcHtmlMitFooter_(pack.html, unsub);
    var subject = pack.subject;

    if (trockenlauf) {
      if (i < maxTrocken) {
        protokoll.push(
          '[Trocken] ' + em.email + ' | ' + subject + ' | unsub=' + (unsub ? 'ja' : 'nein')
        );
        Logger.log(protokoll[protokoll.length - 1]);
      }
      continue;
    }

    try {
      var sendOpts = {
        htmlBody: html,
        name: 'Dorfkino Lögow'
      };
      // Alias nur wenn im Konto eingerichtet — Fehler abfangen
      try {
        sendOpts.from = DKC_FROM_ALIAS_;
        GmailApp.sendEmail(em.email, subject, dkcStripHtml_(html), sendOpts);
      } catch (fromErr) {
        delete sendOpts.from;
        GmailApp.sendEmail(em.email, subject, dkcStripHtml_(html), sendOpts);
      }
      dkcMerkeGesendet_(em.email, campaignId, subject);
      gesendet++;
      if (gesendet <= 3 || gesendet === empfaenger.length) {
        Logger.log('Gesendet ' + gesendet + '/' + empfaenger.length + ' → ' + em.email);
      }
      if (i > 0 && i % 40 === 0) {
        Utilities.sleep(1000);
      }
    } catch (sendErr) {
      fehler++;
      var errMsg = sendErr && sendErr.message ? sendErr.message : String(sendErr);
      Logger.log('Fehler an ' + em.email + ': ' + errMsg);
      protokoll.push('FEHLER ' + em.email + ': ' + errMsg);
      // Quota mitten im Lauf erschöpft → abbrechen, Fortschritt bleibt in DKC_Sent
      if (/quota|limit|exceed/i.test(errMsg)) {
        protokoll.push('Abbruch wegen Kontingent — später Charge fortsetzen.');
        break;
      }
    }
  }

  var restInfo = '';
  if (!trockenlauf && !opts.testNurAn) {
    var nach = dkcLeseEmpfaengerFuerKampagne_(campaignId);
    restInfo =
      '\nBereits gesendet (Kampagne): ' +
      nach.schon +
      '\nNoch offen: ' +
      nach.offen +
      (nach.offen > 0
        ? '\n→ Morgen/später erneut „Newsletter: Echtversand / Charge“.'
        : '\n→ Kampagne vollständig.');
  }

  var meldung;
  if (trockenlauf) {
    meldung =
      'Trockenlauf OK — 0 Mails gesendet.\n' +
      'Würde senden an: ' +
      geplant +
      ' Adressen (active).\n' +
      'Aktiv in VL_all: ' +
      liste.aktiv +
      '.\n' +
      'Entwurf: ' +
      pack.subject +
      '\n' +
      'Protokoll (max 3):\n' +
      protokoll.join('\n') +
      dkcQuotaHinweis_() +
      (webAppUrl
        ? ''
        : '\n\n⚠ Web-App-URL fehlt: Abmeldelink unvollständig. Bitte Web-App deployen (doGet) und Property DKC_WEBAPP_URL setzen.');
  } else {
    meldung =
      'Charge fertig.\nGesendet jetzt: ' +
      gesendet +
      '\nFehler: ' +
      fehler +
      '\nBetreff: ' +
      pack.subject +
      restInfo +
      (protokoll.length ? '\n\n' + protokoll.slice(0, 10).join('\n') : '');
  }

  return {
    gesendet: gesendet,
    fehler: fehler,
    meldung: meldung,
    protokoll: protokoll
  };
}

/** @private */
function dkcGetQuotaSafe_() {
  try {
    return MailApp.getRemainingDailyQuota();
  } catch (e) {
    return 0;
  }
}

/** @private */
function dkcQuotaHinweis_() {
  var q = dkcGetQuotaSafe_();
  var txt = '\n\nTageskontingent (MailApp/GmailApp): ' + q;
  if (q > 0 && q <= 100) {
    txt += '\n\n' + dkcQuotaErklaerung_();
  }
  return txt;
}

/** @private */
function dkcQuotaErklaerung_() {
  return (
    'Hinweis: 100 Empfänger/Tag ist das typische Consumer-Limit von Apps Script. ' +
    'Workspace Business liegt oft bei ~1500 — wenn du 100 siehst trotz Workspace-Konto: ' +
    'Admin prüfen (Lizenz, Mail-Routing) oder in Chargen senden (Script speichert Fortschritt in Tab DKC_Sent). ' +
    'GmailApp und MailApp teilen dasselbe Kontingent.'
  );
}

/** @private */
function dkcCampaignId_(subject) {
  return String(subject || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .substring(0, 200);
}

/**
 * @returns {{aktiv:number, schon:number, offen:number, offenListe:Array}}
 * @private
 */
function dkcLeseEmpfaengerFuerKampagne_(campaignId) {
  var alle = dkcLeseEmpfaenger();
  var offenListe = dkcFilterNochNichtGesendet_(alle.empfaenger, campaignId);
  return {
    aktiv: alle.aktiv,
    schon: alle.aktiv - offenListe.length,
    offen: offenListe.length,
    offenListe: offenListe
  };
}

/** @private */
function dkcFilterNochNichtGesendet_(empfaenger, campaignId) {
  var sent = dkcLeseSentSet_(campaignId);
  var out = [];
  var i;
  for (i = 0; i < empfaenger.length; i++) {
    if (!sent[empfaenger[i].email]) out.push(empfaenger[i]);
  }
  return out;
}

/** @private */
function dkcEnsureSentSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(DKC_SENT_SHEET_);
  if (!sh) {
    sh = ss.insertSheet(DKC_SENT_SHEET_);
    sh.getRange(1, 1, 1, 4).setValues([['email', 'campaign', 'subject', 'sent_at']]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** @private */
function dkcLeseSentSet_(campaignId) {
  var set = {};
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DKC_SENT_SHEET_);
  if (!sh || sh.getLastRow() < 2) return set;
  var data = sh.getRange(2, 1, sh.getLastRow(), 2).getValues();
  var i;
  var want = String(campaignId || '');
  for (i = 0; i < data.length; i++) {
    var em = String(data[i][0] || '')
      .trim()
      .toLowerCase();
    var camp = String(data[i][1] || '').trim();
    if (em && camp === want) set[em] = true;
  }
  return set;
}

/** @private */
function dkcMerkeGesendet_(email, campaignId, subject) {
  var sh = dkcEnsureSentSheet_();
  sh.appendRow([
    String(email).toLowerCase(),
    campaignId,
    subject,
    Utilities.formatDate(new Date(), 'Europe/Berlin', 'yyyy-MM-dd HH:mm:ss')
  ]);
}

/**
 * Lädt Betreff + HTML aus Gmail-Entwurf.
 * @private
 */
function dkcLadeEntwurfInhalt_(draftId) {
  var draft = null;
  if (draftId) {
    draft = GmailApp.getDraft(draftId);
  } else {
    draft = dkcFindeNeuestenEntwurf_();
  }
  if (!draft) {
    throw new Error(
      'Kein Gmail-Entwurf gefunden (Betreff beginnt mit „' +
        DKC_DRAFT_SUBJECT_PREFIX_ +
        '“). Zuerst Entwürfe erzeugen und in Gmail freigeben/anpassen.'
    );
  }
  var msg = draft.getMessage();
  var subject = msg.getSubject() || '';
  // Versand-Betreff: Präfix „⟶ Entwürfe:“ entfernen → Newsletter-Betreff aus Body-H2 oder Subject bereinigen
  var sendSubject = subject;
  if (sendSubject.indexOf(DKC_DRAFT_SUBJECT_PREFIX_) === 0) {
    // Versuche Betreff aus HTML (erstes <strong> unter Newsletter)
    var html0 = msg.getBody() || '';
    var mBet = html0.match(/<h2[^>]*>\s*Newsletter\s*<\/h2>[\s\S]*?<strong>([^<]+)<\/strong>/i);
    if (mBet && mBet[1]) {
      sendSubject = mBet[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
    } else {
      sendSubject = sendSubject.replace(DKC_DRAFT_SUBJECT_PREFIX_, '').trim();
    }
  }
  var html = msg.getBody() || '';
  // Nur den Newsletter-Block versenden, falls Multi-Kanal-Entwurf
  html = dkcExtrahiereNewsletterHtml_(html);
  return { subject: sendSubject, html: html, draftId: draft.getId() };
}

/**
 * @private
 */
function dkcFindeNeuestenEntwurf_() {
  var drafts = GmailApp.getDrafts();
  var i;
  for (i = 0; i < drafts.length; i++) {
    var s = drafts[i].getMessage().getSubject() || '';
    if (s.indexOf(DKC_DRAFT_SUBJECT_PREFIX_) === 0) {
      return drafts[i];
    }
  }
  return null;
}

/**
 * Schneidet aus dem Multi-Kanal-Entwurf den Newsletter-HTML-Teil.
 * @private
 */
function dkcExtrahiereNewsletterHtml_(html) {
  var h = String(html || '');
  // Zwischen <h2>Newsletter</h2> und nächstem <h2>
  var re = /<h2[^>]*>\s*Newsletter\s*<\/h2>([\s\S]*?)(?=<h2[^>]*>|$)/i;
  var m = h.match(re);
  if (m && m[1]) {
    var block = m[1];
    // strong-Betreffzeile optional behalten oder weglassen — Body ohne Zeichen-Zeile
    block = block.replace(/<p><em>Zeichen:[\s\S]*?<\/em><\/p>/gi, '');
    // erstes <strong>Betreff</strong> entfernen (steht schon in Subject)
    block = block.replace(/^\s*<p><strong>[\s\S]*?<\/strong><\/p>\s*/i, '');
    return block.trim() || h;
  }
  return h;
}

/**
 * Footer mit Impressum + Abmelden.
 * @private
 */
function dkcHtmlMitFooter_(html, abmeldeUrl) {
  var foot =
    '<hr style="margin-top:2em;border:none;border-top:1px solid #ccc;">' +
    '<p style="font-size:13px;color:#444;line-height:1.45;">' +
    'Dorfkino Lögow. Das kleinste Kino. Verbindet.<br>' +
    'Schulstraße 2, 16845 Lögow, Germany<br>' +
    'Tel.: +49 173 53 95 237</p>' +
    '<p style="font-size:12px;color:#666;">Sie erhalten diese E-Mail, weil Sie sich bei uns angemeldet haben.<br>';
  if (abmeldeUrl) {
    foot +=
      '<a href="' +
      dkcEscapeAttr_(abmeldeUrl) +
      '">Abmelden</a></p>';
  } else {
    foot +=
      'Abmelden: antworten Sie mit „Abmelden“ an info@dorfkinoloegow.de</p>';
  }
  var body = String(html || '');
  if (body.toLowerCase().indexOf('abmelden') !== -1 && abmeldeUrl) {
    // ersetze Platzhalter falls vorhanden
    body = body.replace(/\{\{ABMELDELINK\}\}/g, abmeldeUrl);
    body = body.replace(/\{\{UNSUBSCRIBE_URL\}\}/g, abmeldeUrl);
  }
  return body + foot;
}

/**
 * @private
 */
function dkcBaueAbmeldeUrl_(email, webAppUrl) {
  if (!webAppUrl) return '';
  var token = dkcUnsubToken_(email);
  var base = String(webAppUrl).split('?')[0];
  return (
    base +
    '?e=' +
    encodeURIComponent(email) +
    '&t=' +
    encodeURIComponent(token)
  );
}

/**
 * HMAC-ähnlich: Hex-SHA256 von secret|email
 * @private
 */
function dkcUnsubToken_(email) {
  var secret = dkcGetUnsubSecret_();
  var raw = secret + '|' + String(email || '').toLowerCase().trim();
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    raw,
    Utilities.Charset.UTF_8
  );
  return dkcBytesToHex_(digest);
}

/** @private */
function dkcGetUnsubSecret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('DKC_UNSUB_SECRET');
  if (!s || !String(s).trim()) {
    // einmalig erzeugen
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('DKC_UNSUB_SECRET', s);
  }
  return String(s).trim();
}

/** @private */
function dkcGetWebAppUrl_() {
  var props = PropertiesService.getScriptProperties();
  var u = props.getProperty('DKC_WEBAPP_URL');
  return u && String(u).trim() ? String(u).trim() : '';
}

/**
 * Web-App-Endpunkt: Abmeldung.
 * Deployment: Als Web-App deployen (ausführen als: ich, Zugriff: jeder).
 * URL in Script Property DKC_WEBAPP_URL speichern.
 *
 * @param {Object} e
 * @returns {HtmlOutput|TextOutput}
 */
function doGet(e) {
  e = e || {};
  var p = e.parameter || {};
  var email = String(p.e || '')
    .trim()
    .toLowerCase();
  var token = String(p.t || '').trim();

  if (!email || !token) {
    return dkcUnsubHtml_(
      'Abmeldung',
      'Link unvollständig. Bitte den Link aus dem Newsletter verwenden.',
      false
    );
  }
  if (!dkcEmailOk_(email)) {
    return dkcUnsubHtml_('Abmeldung', 'Ungültige Adresse.', false);
  }
  var expect = dkcUnsubToken_(email);
  if (token !== expect) {
    return dkcUnsubHtml_('Abmeldung', 'Link ungültig oder abgelaufen.', false);
  }

  try {
    dkcMarkUnsubscribed_(email, 'web-unsub');
    return dkcUnsubHtml_(
      'Abgemeldet',
      'Die Adresse ' +
        email +
        ' wurde abgemeldet. Sie erhalten keine weiteren Newsletter vom Dorfkino Lögow.',
      true
    );
  } catch (err) {
    return dkcUnsubHtml_(
      'Fehler',
      'Abmeldung technisch fehlgeschlagen. Bitte mailen Sie an info@dorfkinoloegow.de.',
      false
    );
  }
}

/**
 * Setzt status=unsubscribed in VL_all.
 * @private
 */
function dkcMarkUnsubscribed_(email, reason) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(DKC_VL_SHEET_);
  if (!sh) throw new Error('VL_all fehlt');

  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) {
    return String(h || '').trim();
  });
  var iEmail = dkcHeaderIndex_(headers, ['Subscriber', 'E-Mail', 'Email']);
  var iStatus = dkcHeaderIndex_(headers, ['status', 'Status']);
  var iWhen = dkcHeaderIndex_(headers, ['Unsubscribed at', 'Unsubscribed At']);
  var iReason = dkcHeaderIndex_(headers, ['Unsubscribe reason', 'Unsubscribe Reason']);
  if (iEmail < 0 || iStatus < 0) throw new Error('Spalten fehlen');

  var want = String(email).toLowerCase().trim();
  var r;
  var found = false;
  for (r = 1; r < values.length; r++) {
    var cell = String(values[r][iEmail] || '')
      .trim()
      .toLowerCase();
    if (cell === want) {
      sh.getRange(r + 1, iStatus + 1).setValue('unsubscribed');
      if (iWhen >= 0) {
        sh.getRange(r + 1, iWhen + 1).setValue(
          Utilities.formatDate(new Date(), 'Europe/Berlin', 'yyyy-MM-dd HH:mm:ss')
        );
      }
      if (iReason >= 0) {
        var prev = String(values[r][iReason] || '').trim();
        if (!prev) sh.getRange(r + 1, iReason + 1).setValue(reason || 'web-unsub');
      }
      found = true;
      break;
    }
  }
  if (!found) {
    // trotzdem ok anzeigen — Privacy
    found = true;
  }
  return found;
}

/** @private */
function dkcUnsubHtml_(title, text, ok) {
  var color = ok ? '#0f6a6f' : '#a33';
  var html =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' +
    dkcEscapeHtml_(title) +
    '</title></head><body style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;">' +
    '<h1 style="color:' +
    color +
    ';">' +
    dkcEscapeHtml_(title) +
    '</h1><p>' +
    dkcEscapeHtml_(text) +
    '</p>' +
    '<p style="color:#666;font-size:14px;">Dorfkino Lögow · Schulstraße 2 · 16845 Lögow</p>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html).setTitle(title);
}

/** @private */
function dkcHeaderIndex_(headers, names) {
  var i, j;
  for (j = 0; j < names.length; j++) {
    var want = String(names[j]).toLowerCase();
    for (i = 0; i < headers.length; i++) {
      if (String(headers[i] || '').toLowerCase() === want) return i;
    }
  }
  return -1;
}

/** @private */
function dkcEmailOk_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

/** @private */
function dkcBytesToHex_(bytes) {
  var out = '';
  var i;
  for (i = 0; i < bytes.length; i++) {
    var b = bytes[i];
    if (b < 0) b += 256;
    var h = b.toString(16);
    if (h.length === 1) h = '0' + h;
    out += h;
  }
  return out;
}

/** @private */
function dkcStripHtml_(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 5000);
}

/**
 * Schnelltest Filter + Token (kein Send).
 */
function dkcTestVersand_() {
  var r = dkcLeseEmpfaenger();
  Logger.log('active=' + r.aktiv + ' aussortiert=' + r.aussortiert);
  var sample = 'test@example.com';
  var t1 = dkcUnsubToken_(sample);
  var t2 = dkcUnsubToken_(sample);
  if (t1 !== t2) throw new Error('Token nicht stabil');
  if (t1 === dkcUnsubToken_('other@example.com')) throw new Error('Token kollidiert');
  Logger.log('Token-OK len=' + t1.length);
  Logger.log('Quota=' + MailApp.getRemainingDailyQuota());
  return r;
}
