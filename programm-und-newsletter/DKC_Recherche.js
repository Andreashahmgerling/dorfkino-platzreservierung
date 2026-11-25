/**
 * DKC — Recherche mit Quellenpflicht (Call 1).
 */

/** Versionierter Tool-Typ — vor Bau gegen Anthropic-Doku prüfbar. */
var DKC_WEB_SEARCH_TOOL_TYPE_ = 'web_search_20250305';

var DKC_FAKT_ARTEN_ = {
  preis: true,
  kritik: true,
  produktion: true,
  werk: true,
  praktisch: true
};

/**
 * @param {Object} film
 * @param {Object} prompts — aus dkcLesePrompts()
 * @returns {{fakten: Array<{aussage:string, quelle:string, art:string}>}}
 */
function dkcRecherchiere(film, prompts) {
  if (!prompts || !prompts.recherche) {
    throw new Error('Recherche: Prompt „recherche" fehlt.');
  }

  var userPayload = dkcFilmCompact_(film);

  var parsed;
  try {
    parsed = dkcRufeClaude({
      system: prompts.recherche,
      messages: [{ role: 'user', content: JSON.stringify(userPayload) }],
      tools: [
        {
          type: DKC_WEB_SEARCH_TOOL_TYPE_,
          name: 'web_search',
          max_uses: 5
        }
      ],
      maxTokens: 40000
    });
  } catch (e) {
    throw new Error('Recherche: ' + (e && e.message ? e.message : String(e)));
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.fakten)) {
    throw new Error('Recherche: Antwort ohne gültiges fakten-Array.');
  }

  var gefiltert = dkcFilterFakten_(parsed.fakten);
  if (gefiltert.length > 5) {
    gefiltert = gefiltert.slice(0, 5);
  }
  return { fakten: gefiltert };
}

/**
 * Filtert Fakten (auch für Tests ohne API-Call nutzbar).
 * @param {Array} fakten
 * @returns {Array<{aussage:string, quelle:string, art:string}>}
 */
function dkcFilterFakten_(fakten) {
  var out = [];
  if (!fakten || !fakten.length) return out;
  var i;
  for (i = 0; i < fakten.length; i++) {
    var f = fakten[i] || {};
    var aussage = String(f.aussage || '').trim();
    var quelle = String(f.quelle || '').trim();
    var art = String(f.art || '').trim().toLowerCase();
    if (!aussage) continue;
    if (!(quelle.indexOf('http://') === 0 || quelle.indexOf('https://') === 0)) continue;
    if (!DKC_FAKT_ARTEN_[art]) continue;
    out.push({ aussage: aussage, quelle: quelle, art: art });
  }
  return out;
}

/** @private */
function dkcFilmCompact_(film) {
  film = film || {};
  return {
    Titel: film['Titel'] || '',
    Originaltitel: film['Originaltitel'] || '',
    Jahr: film['Jahr'] || '',
    Genre: film['Genre'] || '',
    Regisseur: film['Regisseur'] || '',
    Autor: film['Autor'] || '',
    'Darsteller 1': film['Darsteller 1'] || '',
    'Darsteller 2': film['Darsteller 2'] || '',
    'Darsteller 3': film['Darsteller 3'] || '',
    Overview: film['Overview'] || '',
    'TMDB-Link': film['TMDB-Link'] || '',
    Wochentag: film['Wochentag'] || '',
    Date: film['Date'] || '',
    'Start time': film['Start time'] || '',
    '2nd start': film['2nd start'] || '',
    Reihe: film['Reihe'] || ''
  };
}
