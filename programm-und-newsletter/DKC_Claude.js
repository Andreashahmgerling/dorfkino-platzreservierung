/**
 * DKC — Anthropic Messages API Client.
 * Key nie loggen, nie in Fehlermeldungen schreiben.
 */

var DKC_ANTHROPIC_URL_ = 'https://api.anthropic.com/v1/messages';
var DKC_ANTHROPIC_VERSION_ = '2023-06-01';

/**
 * @param {{system:string, messages:Array, tools?:Array, maxTokens?:number}} opts
 * @returns {Object} geparstes JSON-Objekt aus der Modell-Antwort (eingebettetes JSON)
 */
function dkcRufeClaude(opts) {
  opts = opts || {};
  var config = dkcGetConfig();
  // Output-Budget bewusst hoch (40k): Sonnet 5 + lange Kanaltexte / Recherche.
  var maxTokens = opts.maxTokens || 40000;

  var body = {
    model: config.model || 'claude-sonnet-5',
    max_tokens: maxTokens,
    system: opts.system || '',
    messages: opts.messages || [],
    thinking: { type: 'disabled' }
  };
  if (opts.tools && opts.tools.length) {
    body.tools = opts.tools;
  }
  // Strukturierte Ausgabe: erzwungenes Tool liefert sauberes JSON (kein Parsen aus Fließtext)
  if (opts.ausgabeSchema) {
    body.tools = (body.tools || []).concat([{
      name: 'ausgabe',
      description: 'Gibt das Ergebnis als strukturiertes Objekt zurück.',
      input_schema: opts.ausgabeSchema
    }]);
    body.tool_choice = { type: 'tool', name: 'ausgabe' };
  }

  var payload = JSON.stringify(body);
  var attempt = 0;
  var maxAttempts = 3; // 1 initial + 2 retries
  var lastCode = 0;
  var lastText = '';

  while (attempt < maxAttempts) {
    var res = UrlFetchApp.fetch(DKC_ANTHROPIC_URL_, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': DKC_ANTHROPIC_VERSION_
      },
      payload: payload,
      muteHttpExceptions: true
    });

    lastCode = res.getResponseCode();
    lastText = res.getContentText() || '';

    if (lastCode === 200) {
      var apiResponse = dkcParseJsonSafe_(lastText);
      if (!apiResponse) {
        throw new Error('Anthropic: Antwort ist kein JSON (HTTP 200).');
      }
      if (opts.ausgabeSchema) {
        var blocks = apiResponse.content || [];
        for (var bi = 0; bi < blocks.length; bi++) {
          if (blocks[bi] && blocks[bi].type === 'tool_use' && blocks[bi].name === 'ausgabe') {
            return blocks[bi].input;
          }
        }
        throw new Error('Anthropic: keine strukturierte Ausgabe (stop_reason=' + (apiResponse.stop_reason || '?') + ').');
      }
      return dkcExtractEmbeddedJson_(apiResponse);
    }

    if (lastCode === 400 || lastCode === 401) {
      throw new Error(
        'Anthropic HTTP ' + lastCode + ': ' + dkcSanitizeApiError_(lastText, config.apiKey)
      );
    }

    // 429 / 5xx → retry
    if (lastCode === 429 || lastCode >= 500) {
      attempt++;
      if (attempt >= maxAttempts) break;
      Utilities.sleep(attempt === 1 ? 2000 : 8000);
      continue;
    }

    // andere Codes: sofort
    throw new Error(
      'Anthropic HTTP ' + lastCode + ': ' + dkcSanitizeApiError_(lastText, config.apiKey)
    );
  }

  throw new Error(
    'Anthropic HTTP ' + lastCode + ' nach Retries: ' + dkcSanitizeApiError_(lastText, config.apiKey)
  );
}

/**
 * Nimmt die Messages-API-Antwort und extrahiert das eingebettete JSON-Objekt
 * aus dem letzten type:"text"-Block.
 * @param {Object} apiResponse
 * @returns {Object}
 */
function dkcExtractEmbeddedJson_(apiResponse) {
  var text = dkcLastTextBlock_(apiResponse);
  if (!text) {
    throw new Error('Anthropic: kein Text-Block in der Antwort.');
  }

  var parsed = dkcParseJsonFromModelText_(text);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Anthropic: kein JSON-Objekt in der Modell-Antwort.');
  }
  return parsed;
}

/** @private */
function dkcLastTextBlock_(apiResponse) {
  var content = apiResponse && apiResponse.content;
  if (!content || !content.length) {
    var stop = apiResponse && apiResponse.stop_reason;
    var usage = apiResponse && apiResponse.usage;
    var think = usage && usage.output_tokens_details && usage.output_tokens_details.thinking_tokens;
    var hint = stop ? ' stop_reason=' + stop : '';
    if (think) hint += ' thinking_tokens=' + think;
    throw new Error('Anthropic: content leer.' + hint);
  }
  var i;
  for (i = content.length - 1; i >= 0; i--) {
    var block = content[i];
    if (block && block.type === 'text' && block.text) {
      return String(block.text);
    }
  }
  // Diagnose: nur thinking / tool blocks
  var types = [];
  for (i = 0; i < content.length; i++) {
    if (content[i] && content[i].type) types.push(content[i].type);
  }
  var stop2 = apiResponse.stop_reason || '?';
  throw new Error(
    'Anthropic: kein Text-Block (content-Typen: ' +
      types.join(',') +
      '; stop_reason=' +
      stop2 +
      ').'
  );
}

/**
 * Reines JSON, ```json-Codeblock, oder erster {...}-Block.
 * @private
 */
function dkcParseJsonFromModelText_(text) {
  var t = String(text || '').trim();
  if (!t) return null;

  // fenced code block
  var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) {
    var fromFence = dkcParseJsonSafe_(fence[1].trim());
    if (fromFence) return fromFence;
  }

  // pure JSON
  var pure = dkcParseJsonSafe_(t);
  if (pure) return pure;

  // first {...} brace block
  var start = t.indexOf('{');
  var end = t.lastIndexOf('}');
  if (start !== -1 && end > start) {
    return dkcParseJsonSafe_(t.substring(start, end + 1));
  }
  return null;
}

/** @private */
function dkcParseJsonSafe_(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

/**
 * Fehlertext ohne API-Key.
 * @private
 */
function dkcSanitizeApiError_(text, apiKey) {
  var msg = String(text || '');
  if (apiKey && msg.indexOf(apiKey) !== -1) {
    msg = msg.split(apiKey).join('[REDACTED]');
  }
  // Anthropic error JSON: {"error":{"message":"..."}}
  try {
    var j = JSON.parse(msg);
    if (j && j.error && j.error.message) {
      return String(j.error.message).substring(0, 500);
    }
  } catch (e) {
    // plain text
  }
  if (msg.length > 500) msg = msg.substring(0, 500) + '…';
  return msg;
}
