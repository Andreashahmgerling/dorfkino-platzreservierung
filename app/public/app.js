const root = document.querySelector('#app');
const params = new URLSearchParams(location.search);
const film = params.get('film');
let config = {};
let events = [];
let selectedId;
let requestKey = crypto.randomUUID();
let submittedFingerprint = '';
let submitting = false;
let completed = false;
let poll;
let step = 1; // 1 = Vorstellung wählen, 2 = Plätze & Kontakt (einspaltiger Schritt-für-Schritt-Ablauf)
const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
const date = value => new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: 'long' }).format(new Date(value));
const time = value => new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const api = async (path, data) => {
  const res = await fetch(path, { ...(data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}), cache: 'no-store' });
  const result = await res.json();
  if (!res.ok) { const error = new Error(result.error || 'Die Anfrage ist fehlgeschlagen.'); error.status = res.status; throw error; }
  return result;
};
const heading = (eyebrow, title, description) => { const wrap = el('div', undefined, 'intro'); if (eyebrow) wrap.append(el('p', eyebrow, 'eyebrow')); wrap.append(el('h1', title)); if (description) wrap.append(el('p', description, 'lede')); return wrap; };
const alertBox = () => { const box = el('p', '', 'error'); box.setAttribute('role', 'alert'); box.hidden = true; return box; };
const showError = (box, error) => { box.textContent = error.message || String(error); box.hidden = false; };
const link = (label, href, cls) => { const a = el('a', label, cls); a.href = href; return a; };
const eventUrl = () => `/api/events${film ? `?film=${encodeURIComponent(film)}` : ''}`;

function program() {
  root.replaceChildren(heading('', 'Dein Platz im Dorfkino.', 'Film auswählen, Plätze reservieren, auf den Kinoabend freuen.'));
  if (!events.length) {
    const empty = el('section', undefined, 'empty');
    empty.append(el('h2', 'Hier geht es bald weiter.'), el('p', film ? 'Für diesen Film gibt es aktuell keine buchbare Vorstellung.' : 'Aktuell sind keine Vorstellungen zur Reservierung freigeschaltet.'), link('Fragen zum Programm? Schreib uns.', 'mailto:ticket@dorfkinoloegow.de'));
    if (film) empty.append(link('Alle Vorstellungen ansehen', '/'));
    root.append(empty); return;
  }
  if (!events.some(e => e.id === selectedId)) selectedId = events.find(e => e.available > 0)?.id || events[0].id;
  const layout = el('div', undefined, 'booking-layout');
  const programList = el('section', undefined, 'program'); programList.setAttribute('aria-label', 'Vorstellungen');
  programList.append(el('h2', '01 — Vorstellung wählen', 'section-label'));
  const cards = el('div', undefined, 'film-list');
  for (const event of events) {
    const button = el('button', undefined, `film-card${event.id === selectedId ? ' selected' : ''}`); button.type = 'button'; button.dataset.eventId = event.id;
    button.setAttribute('aria-pressed', event.id === selectedId ? 'true' : 'false');
    const timing = el('span', undefined, 'film-timing'); timing.append(el('span', date(event.startsAt)), el('strong', `${time(event.startsAt)} Uhr`));
    const main = el('span', undefined, 'film-main'); main.append(el('span', event.title, 'film-title'));
    if (event.note) main.append(el('span', event.note, 'film-note'));
    const bottom = el('span', undefined, 'film-bottom'); bottom.append(el('span', '', 'availability'), el('span', event.id === selectedId ? 'Ausgewählt ✓' : 'Vorstellung wählen →', 'choice'));
    main.append(bottom); button.append(timing, main);
    button.addEventListener('click', () => {
      if (submitting || completed) return;
      selectedId = event.id; requestKey = crypto.randomUUID(); submittedFingerprint = ''; step = 2;
      program(); window.scrollTo({ top: 0, behavior: 'auto' }); root.querySelector('#selected-title')?.focus();
    });
    cards.append(button);
  }
  programList.append(cards);
  const panel = el('section', undefined, 'reservation-panel'); panel.setAttribute('aria-label', 'Plätze reservieren');
  panel.append(el('h2', '02 — Plätze reservieren', 'section-label'));
  const form = el('form'); form.id = 'reservation-form';
  const title = el('h3', '', 'form-title'); title.id = 'selected-title';
  const timing = el('p', '', 'muted'); timing.id = 'selected-time';
  const change = el('button', '← Andere Vorstellung wählen', 'change-link'); change.type = 'button';
  change.addEventListener('click', () => { if (submitting || completed) return; step = 1; program(); window.scrollTo({ top: 0, behavior: 'auto' }); });
  title.tabIndex = -1;
  const qtyLabel = el('label', 'Wie viele kommen mit?'); qtyLabel.htmlFor = 'quantity';
  const qty = el('select'); qty.id = 'quantity'; qty.name = 'quantity'; qty.required = true;
  const availability = el('p', '', 'small'); availability.id = 'remaining'; availability.setAttribute('aria-live', 'polite');
  const nameLabel = el('label', 'Dein Name'); nameLabel.htmlFor = 'name';
  const name = el('input'); name.id = 'name'; name.name = 'name'; name.autocomplete = 'name'; name.required = true; name.maxLength = 100;
  const emailLabel = el('label', 'Deine E-Mail-Adresse'); emailLabel.htmlFor = 'email';
  const email = el('input'); email.id = 'email'; email.name = 'email'; email.type = 'email'; email.autocomplete = 'email'; email.required = true; email.maxLength = 254;
  const notesLabel = el('label', 'Anmerkungen/Mitglieder'); notesLabel.htmlFor = 'notes';
  const notes = el('textarea'); notes.id = 'notes'; notes.name = 'notes'; notes.rows = 3; notes.maxLength = 1000;
  const notesHelp = el('p', 'Optional · bis zu 1.000 Zeichen', 'small'); notesHelp.id = 'notes-help'; notes.setAttribute('aria-describedby', 'notes-help');
  const honey = el('div', undefined, 'honey'); honey.setAttribute('aria-hidden', 'true');
  const honeyLabel = el('label', 'Website'); honeyLabel.htmlFor = 'website'; const website = el('input'); website.id = 'website'; website.tabIndex = -1; website.autocomplete = 'off'; honey.append(honeyLabel, website);
  const help = el('p', 'Die Bestätigung und einen Stornolink schicken wir dir per E-Mail.', 'small');
  const terms = el('div', undefined, 'conditions'); terms.append(el('p', 'Freie Sitzwahl im Kino. Bezahlung vor Ort.'), el('p', 'Eintritt: 9 € · ermäßigt 6 € · Mitglieder 4,50 €', 'price-line'));
  const submit = el('button', 'Verbindlich reservieren', 'primary'); submit.type = 'submit'; submit.id = 'reserve-button';
  const error = alertBox(); error.id = 'booking-error';
  form.append(title, timing, change, qtyLabel, qty, availability, nameLabel, name, emailLabel, email, help, notesLabel, notes, notesHelp, honey, terms);
  if (config.privacyUrl) { const privacy = el('p', 'Deine Angaben verwenden wir zur Abwicklung deiner Reservierung. ', 'small'); privacy.append(link('Datenschutzhinweise', config.privacyUrl)); form.append(privacy); }
  form.append(error, submit); panel.append(form);
  // Einspaltig in Schritten: erst Vorstellung, dann Formular. Kein Formular zwischen den Karten.
  layout.append(step === 2 ? panel : programList); root.append(layout);
  updateSelection(true);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (submitting || completed) return;
    const quantity = Number(qty.value);
    const input = { eventId: selectedId, quantity, name: name.value.trim(), email: email.value.trim(), notes: notes.value.trim(), website: website.value };
    const fingerprint = JSON.stringify(input);
    if (submittedFingerprint && submittedFingerprint !== fingerprint) requestKey = crypto.randomUUID();
    submittedFingerprint = fingerprint;
    const selected = events.find(e => e.id === selectedId);
    submitting = true; submit.disabled = true; submit.textContent = 'Wird reserviert …'; error.hidden = true;
    for (const node of form.querySelectorAll('input,select,textarea')) node.disabled = true;
    try {
      const result = await api('/api/reservations', { ...input, requestKey });
      completed = true; clearInterval(poll); confirmation(result, selected);
    } catch (err) {
      showError(error, err.status ? err : new Error('Die Verbindung wurde unterbrochen. Bitte unverändert erneut senden: Dieselbe Anfrage wird nur einmal gebucht.'));
      if (err.status === 409 || err.status === 404) {
        try { events = (await api(eventUrl())).events; updateSelection(false); } catch {}
      }
    } finally {
      submitting = false;
      if (!completed) { for (const node of form.querySelectorAll('input,select,textarea')) node.disabled = false; updateSelection(false); submit.textContent = 'Verbindlich reservieren'; }
    }
  });
}
function updateSelection(reset) {
  for (const card of root.querySelectorAll('[data-event-id]')) {
    const event = events.find(e => e.id === card.dataset.eventId);
    const n = event?.available || 0; const text = card.querySelector('.availability');
    text.textContent = n ? `${n} von 16 Plätzen frei` : 'Ausgebucht / nicht mehr buchbar'; text.classList.toggle('sold-out', !n);
  }
  const event = events.find(e => e.id === selectedId);
  const qty = document.querySelector('#quantity'); if (!qty) return;
  const old = Number(qty.value || 1); const n = event?.available || 0;
  document.querySelector('#selected-title').textContent = event?.title || 'Nicht mehr buchbar';
  document.querySelector('#selected-time').textContent = event ? `${date(event.startsAt)} · ${time(event.startsAt)} Uhr` : '';
  // Bei Netzwerkfehler unveränderten Request wiederholbar halten; nie still die Anzahl ändern.
  if (reset || !qty.options.length) {
    qty.replaceChildren();
    for (let i = 1; i <= Math.max(1, n); i++) { const option = el('option', `${i} ${i === 1 ? 'Platz' : 'Plätze'}`); option.value = i; qty.append(option); }
    qty.value = Math.min(old, Math.max(1, n));
  } else {
    for (let i = qty.options.length + 1; i <= n; i++) { const option = el('option', `${i} Plätze`); option.value = i; qty.append(option); }
  }
  document.querySelector('#remaining').textContent = n ? `Noch ${n} Plätze verfügbar. Es werden keine festen Sitze vergeben.` : 'Diese Vorstellung ist derzeit nicht mehr buchbar.';
  document.querySelector('#reserve-button').disabled = submitting || (!n && !submittedFingerprint);
}
function confirmation(result, selected) {
  root.replaceChildren(heading('BIS BALD IM DORFKINO', result.status === 'cancelled' ? 'Bereits storniert.' : 'Deine Plätze sind reserviert.'));
  const ticket = el('section', undefined, 'ticket');
  ticket.append(el('p', config.demo ? 'TESTRESERVIERUNG' : 'RESERVIERUNGSBESTÄTIGUNG', 'eyebrow'), el('h2', selected.title), el('p', `${date(selected.startsAt)} · ${time(selected.startsAt)} Uhr`, 'lede'), el('p', `${result.quantity} ${result.quantity === 1 ? 'Platz' : 'Plätze'} · Freie Sitzwahl`, 'ticket-quantity'), el('p', 'Eintritt: 9 € · ermäßigt 6 € · Mitglieder 4,50 € · Bezahlung vor Ort', 'small'), el('p', `Reservierungsnummer: ${result.id}`, 'small'));
  ticket.append(el('p', config.demo ? 'Dies ist eine lokale Vorschau. Es wurde keine E-Mail versendet.' : result.emailSent ? `Die Bestätigung wurde an ${result.email} versendet.` : `Die Reservierung ist gespeichert. Die Bestätigung an ${result.email} ist zum Versand vorgemerkt.`));
  if (result.notes) ticket.append(el('h3', 'Anmerkungen/Mitglieder'), el('p', result.notes, 'reservation-notes'));
  if (result.cancelUrl) ticket.append(link('Reservierung ansehen / stornieren', result.cancelUrl, 'secondary'));
  else ticket.append(el('p', 'Den Stornolink findest du in deiner Bestätigungs-E-Mail.'));
  if (result.status !== 'cancelled') {
    const feedback = el('div', undefined, 'feedback-prompt');
    feedback.append(el('p', 'War das einfach?', 'lede'));
    const details = el('details'); const summary = el('summary', 'Mehr dazu');
    details.append(summary, el('p', 'Webmuli (also Andreas Hahm-Gerling) hat das programmiert. Bitte geben Sie doch ein Feedback mit Stichworten wie Webdesign oder Internetmarketing auf meinem Google Profil!', 'small'));
    feedback.append(details);
    const review = link('Feedback geben', 'https://g.page/r/CYJZwG_BTybPEBM/review', 'primary');
    review.target = '_blank'; review.rel = 'noopener';
    feedback.append(review);
    ticket.append(feedback);
  }
  ticket.append(link('Zurück zum Programm', '/', 'text-link')); root.append(ticket);
  root.querySelector('h1').tabIndex = -1; root.querySelector('h1').focus();
}
async function cancellation() {
  document.title = 'Reservierung verwalten · Dorfkino Lögow';
  const token = location.hash.slice(1);
  root.replaceChildren(heading('DEINE RESERVIERUNG', 'Pläne geändert?'));
  const panel = el('section', undefined, 'ticket'); const error = alertBox(); panel.append(error); root.append(panel);
  try {
    const result = await api('/api/cancellation', { token });
    panel.append(el('h2', result.title), el('p', `${date(result.startsAt)} · ${time(result.startsAt)} Uhr`), el('p', `${result.quantity} ${result.quantity === 1 ? 'Platz' : 'Plätze'} · ${result.id}`));
    if (result.status === 'cancelled') panel.append(el('p', 'Diese Reservierung ist bereits storniert.', 'notice'));
    else if (!result.canCancel) panel.append(el('p', 'Die Vorstellung hat bereits begonnen. Bitte kontaktiere das Kino.'));
    else {
      panel.append(el('p', 'Bei einer Stornierung geben wir alle Plätze dieser Reservierung wieder frei.'));
      const button = el('button', 'Alle reservierten Plätze stornieren', 'primary'); button.type = 'button';
      button.addEventListener('click', async () => {
        if (!confirm('Möchtest du diese Reservierung vollständig stornieren?')) return;
        button.disabled = true;
        try { await api('/api/cancel', { token }); await cancellation(); }
        catch (err) { showError(error, err); button.disabled = false; }
      }); panel.append(button);
    }
    panel.append(link('Zum Programm', '/', 'text-link'));
  } catch (err) { showError(error, err); }
}
async function admin() {
  document.title = 'Verwaltung · Dorfkino Lögow';
  root.replaceChildren(heading('VERWALTUNG', 'Vorstellungen & Reservierungen.', 'Neue Vorstellungen veröffentlichst du aus deinem Filmplan.'));
  const error = alertBox(); root.append(error);
  try {
    const result = await api('/api/admin/events');
    if (!result.events.length) root.append(el('p', 'Noch keine Vorstellungen importiert.'));
    for (const event of result.events) {
      const section = el('section', undefined, 'admin-event');
      section.append(el('h2', event.title), el('p', `${date(event.startsAt)} · ${time(event.startsAt)} Uhr · ${16 - event.available}/16 reserviert${event.published ? '' : ' · nicht veröffentlicht'}`, 'muted'));
      if (!event.reservations.length) section.append(el('p', 'Noch keine Reservierungen.'));
      for (const reservation of event.reservations) {
        const row = el('div', undefined, 'admin-row'); const info = el('div');
        info.append(el('strong', `${reservation.quantity} Plätze · ${reservation.name}`), el('p', `${reservation.email} · ${reservation.id}`, 'small'), el('p', `${reservation.status === 'confirmed' ? 'Reserviert' : 'Storniert'}${reservation.mailPending ? ' · E-Mail wartet auf Versand' : ''}`, 'small'));
        if (reservation.notes) info.append(el('p', `Anmerkungen/Mitglieder:\n${reservation.notes}`, 'reservation-notes'));
        row.append(info);
        if (reservation.status === 'confirmed') {
          const button = el('button', 'Stornieren', 'secondary'); button.type = 'button';
          button.addEventListener('click', async () => {
            if (!confirm(`${reservation.quantity} Plätze von ${reservation.name} stornieren?`)) return;
            button.disabled = true;
            try { await api('/api/admin/cancel', { id: reservation.id }); await admin(); }
            catch (err) { showError(error, err); button.disabled = false; }
          }); row.append(button);
        }
        section.append(row);
      }
      root.append(section);
    }
  } catch (err) { showError(error, err); }
}
async function main() {
  try {
    config = await api('/api/config');
    document.querySelector('#demo-banner').hidden = !config.demo;
    for (const [id, url] of [['privacy-link', config.privacyUrl], ['imprint-link', config.imprintUrl]]) if (url) { const a = document.getElementById(id); a.href = url; a.hidden = false; }
    if (location.pathname === '/stornieren') return cancellation();
    if (location.pathname === '/admin') return admin();
    events = (await api(eventUrl())).events; program();
    poll = setInterval(async () => {
      if (completed || submitting || document.hidden) return;
      try { events = (await api(eventUrl())).events; updateSelection(false); } catch { /* Beim Absenden wird der Bestand serverseitig geprüft. */ }
    }, 15000);
  } catch (err) {
    root.replaceChildren(heading('DORFKINO LÖGOW', 'Das Programm ist gerade nicht erreichbar.', 'Bitte versuche es erneut oder reserviere per E-Mail.'));
    const retry = el('button', 'Erneut versuchen', 'primary'); retry.addEventListener('click', () => location.reload());
    root.append(retry, link('ticket@dorfkinoloegow.de', 'mailto:ticket@dorfkinoloegow.de', 'text-link'));
  }
}
void main();
