function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('TMDB')
    .addItem('Film-Assistent öffnen', 'openTmdbSidebar')
    .addToUi();
  dkcMenuAnhaengen();  
  dorfkinoMenue();
}

function openTmdbSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('TMDB Film-Assistent');
  SpreadsheetApp.getUi().showSidebar(html);
}

function getTmdbToken_() {
  const token = PropertiesService.getScriptProperties().getProperty('TMDB_BEARER_TOKEN');
  if (!token) {
    throw new Error('TMDB_BEARER_TOKEN fehlt in den Script Properties.');
  }
  return token;
}

function getImageUrl_(path, size) {
  if (!path) return '';
  return 'https://image.tmdb.org/t/p/' + size + path;
}

function getTmdbMovieUrl_(id) {
  return id ? 'https://www.themoviedb.org/movie/' + id : '';
}

function getTargetRow_(sheet = SpreadsheetApp.getActiveSheet(), activeRow = sheet.getActiveCell().getRow()) {
  if (activeRow > 1) return activeRow;
  return Math.max(sheet.getLastRow() + 1, 2);
}

function ensureHeader() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const headers = [[
    'Suchbegriff',
    'TMDB-ID',
    'Titel',
    'Originaltitel',
    'Jahr',
    'Release-Date',
    'Originalsprache',
    'Genre',
    'Laufzeit (min)',
    'Regisseur',
    'Autor',
    'Darsteller 1',
    'Darsteller 2',
    'Darsteller 3',
    'Darsteller 4',
    'Darsteller 5',
    'Bewertung',
    'Votes',
    'Overview',
    'Poster-URL',
    'Backdrop-URL',
    'TMDB-Link',
    'Trailer-Link'
  ]];

  const range = sheet.getRange(1, 1, 1, headers[0].length);
  const values = range.getValues()[0];
  const isEmpty = values.every(v => v === '');

  if (isEmpty) {
    range.setValues(headers);
    sheet.setFrozenRows(1);
  }
}

function searchTmdbMovies(query) {
  const q = String(query || '').trim();
  if (!q) {
    throw new Error('Bitte einen Filmtitel eingeben.');
  }

  const token = getTmdbToken_();
  const url =
    'https://api.themoviedb.org/3/search/movie?query=' +
    encodeURIComponent(q) +
    '&language=de-DE&page=1&include_adult=false';

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json'
    },
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const text = response.getContentText();

  if (status !== 200) {
    throw new Error('TMDB-Fehler ' + status + ': ' + text);
  }

  const data = JSON.parse(text);
  const results = data.results || [];

  return results.slice(0, 8).map(movie => ({
    id: movie.id || '',
    query: q,
    title: movie.title || '',
    original_title: movie.original_title || '',
    release_date: movie.release_date || '',
    year: movie.release_date ? movie.release_date.slice(0, 4) : '',
    original_language: movie.original_language || '',
    vote_average: movie.vote_average || '',
    vote_count: movie.vote_count || '',
    overview: movie.overview || '',
    poster_url: getImageUrl_(movie.poster_path, 'w342'),
    backdrop_url: getImageUrl_(movie.backdrop_path, 'w1280'),
    tmdb_url: getTmdbMovieUrl_(movie.id)
  }));
}

function uniqueNames_(arr) {
  const seen = {};
  return arr.filter(name => {
    const key = String(name || '').trim().toLowerCase();
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function extractWriters_(crew) {
  const writerJobs = ['Writer', 'Screenplay', 'Author', 'Novel', 'Story'];
  const names = (crew || [])
    .filter(person => writerJobs.indexOf(person.job) !== -1)
    .map(person => person.name);
  return uniqueNames_(names).join(', ');
}

function extractDirectors_(crew) {
  const names = (crew || [])
    .filter(person => person.job === 'Director')
    .map(person => person.name);
  return uniqueNames_(names).join(', ');
}

function extractTopCast_(cast, limit) {
  return (cast || [])
    .sort((a, b) => (a.order || 9999) - (b.order || 9999))
    .slice(0, limit)
    .map(person => person.name || '');
}

function extractTrailerUrl_(videos) {
  const results = videos && videos.results ? videos.results : [];
  if (!results.length) return '';

  const youtubeVideos = results.filter(v => v.site === 'YouTube' && v.key);
  if (!youtubeVideos.length) return '';

  const officialTrailer = youtubeVideos.find(v => v.type === 'Trailer' && v.official === true);
  if (officialTrailer) return 'https://www.youtube.com/watch?v=' + officialTrailer.key;

  const anyTrailer = youtubeVideos.find(v => v.type === 'Trailer');
  if (anyTrailer) return 'https://www.youtube.com/watch?v=' + anyTrailer.key;

  const officialTeaser = youtubeVideos.find(v => v.type === 'Teaser' && v.official === true);
  if (officialTeaser) return 'https://www.youtube.com/watch?v=' + officialTeaser.key;

  return 'https://www.youtube.com/watch?v=' + youtubeVideos[0].key;
}

function getMovieDetailsForSelection(movieId, query) {
  const id = Number(movieId);
  if (!id) {
    throw new Error('Ungültige TMDB-ID.');
  }

  const token = getTmdbToken_();
  const url =
    'https://api.themoviedb.org/3/movie/' + id +
    '?language=de-DE&append_to_response=credits,videos';

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json'
    },
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const text = response.getContentText();

  if (status !== 200) {
    throw new Error('TMDB-Fehler ' + status + ': ' + text);
  }

  const movie = JSON.parse(text);
  const genres = (movie.genres || []).map(g => g.name).join(', ');
  const crew = movie.credits && movie.credits.crew ? movie.credits.crew : [];
  const cast = movie.credits && movie.credits.cast ? movie.credits.cast : [];
  const topCast = extractTopCast_(cast, 5);

  while (topCast.length < 5) topCast.push('');

  return {
    query: query || '',
    id: movie.id || '',
    title: movie.title || '',
    original_title: movie.original_title || '',
    release_date: movie.release_date || '',
    year: movie.release_date ? movie.release_date.slice(0, 4) : '',
    original_language: movie.original_language || '',
    genres: genres,
    runtime: movie.runtime ? movie.runtime + ' min.' : '',
    director: extractDirectors_(crew),
    writer: extractWriters_(crew),
    cast1: topCast[0] || '',
    cast2: topCast[1] || '',
    cast3: topCast[2] || '',
    cast4: topCast[3] || '',
    cast5: topCast[4] || '',
    vote_average: movie.vote_average || '',
    vote_count: movie.vote_count || '',
    overview: movie.overview || '',
    poster_url: getImageUrl_(movie.poster_path, 'w500'),
    backdrop_url: getImageUrl_(movie.backdrop_path, 'w1280'),
    tmdb_url: getTmdbMovieUrl_(movie.id),
    trailer_url: extractTrailerUrl_(movie.videos)
  };
}

function getScreeningValues_(screening) {
  const date = String(screening.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Bitte das Vorführdatum eingeben.');
  }
  const timeZone = 'Europe/Berlin';
  const parsed = Utilities.parseDate(date, timeZone, 'yyyy-MM-dd');
  if (Utilities.formatDate(parsed, timeZone, 'yyyy-MM-dd') !== date) {
    throw new Error('Bitte ein gültiges Vorführdatum eingeben.');
  }

  const times = [screening.firstStart, screening.secondStart];
  if (times.some(time => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
    throw new Error('Bitte beide Startzeiten eingeben.');
  }
  if (times[0] === times[1]) {
    throw new Error('Bitte zwei unterschiedliche Startzeiten eingeben.');
  }
  // Sheets speichert Uhrzeiten als Bruchteile eines Tages.
  const dayFractions = times.map(time => {
    const [hour, minute] = time.split(':').map(Number);
    return (hour * 60 + minute) / 1440;
  });
  return [
    Utilities.formatDate(parsed, timeZone, 'dd.MM.yyyy'),
    Utilities.formatDate(parsed, timeZone, 'yyyy.MM.dd'),
    ...dayFractions,
    'Aktuell'
  ];
}

function writeSelectedMovieToSheet(selection, screening = {}) {
  const screeningValues = getScreeningValues_(screening);
  const comment = screening.comment;
  if (comment !== null && (typeof comment !== 'string' || !comment.trim())) {
    throw new Error('Bitte einen Kommentar eingeben oder den Kommentar überspringen.');
  }

  const sheet = SpreadsheetApp.getActiveSheet();
  const activeRow = sheet.getActiveCell().getRow();
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0];
  const screeningHeaders = ['Date', 'date hide', 'Start time', '2nd start', 'Status'];
  const commentColumn = headers.indexOf('Kommentar') + 1;
  if (!screeningHeaders.every((header, index) => headers[24 + index] === header) || !commentColumn) {
    throw new Error('Bitte die Filmzeile im Filmprogramm auswählen. Dort müssen Y bis AC und die Spalte „Kommentar“ vorhanden sein.');
  }
  const detail = getMovieDetailsForSelection(selection.id, selection.query);

  const values = [[
    detail.query,
    detail.id,
    detail.title,
    detail.original_title,
    detail.year,
    detail.release_date,
    detail.original_language,
    detail.genres,
    detail.runtime,
    detail.director,
    detail.writer,
    detail.cast1,
    detail.cast2,
    detail.cast3,
    detail.cast4,
    detail.cast5,
    detail.vote_average,
    detail.vote_count,
    detail.overview,
    detail.poster_url,
    detail.backdrop_url,
    detail.tmdb_url,
    detail.trailer_url
  ]];

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) {
    throw new Error('Ein anderer Vorgang läuft gerade. Bitte erneut versuchen.');
  }
  try {
    const row = getTargetRow_(sheet, activeRow);
    const movieCells = sheet.getRange(row, 1, 1, values[0].length);
    const screeningCells = sheet.getRange(row, 25, 1, screeningHeaders.length);
    const commentCell = comment === null ? null : sheet.getRange(row, commentColumn);
    if (!movieCells.canEdit() || !screeningCells.canEdit() || (commentCell && !commentCell.canEdit())) {
      throw new Error('Die Zielzeile enthält geschützte Zellen. Bitte eine bearbeitbare Filmzeile auswählen.');
    }

    sheet.getRange(row, 27, 1, 2).setNumberFormat('hh:mm');
    movieCells.setValues(values);
    screeningCells.setValues([screeningValues]);
    if (commentCell) {
      commentCell.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(comment).build());
    }
    SpreadsheetApp.flush();
    return { row: row, sheetName: sheet.getName(), title: detail.title || '' };
  } finally {
    lock.releaseLock();
  }
}
