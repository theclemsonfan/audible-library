// Untrusted browser observations are normalized before they enter the database.
export const SOURCES = new Set(['library', 'purchases', 'refunds', 'listens', 'catalog']);
export const ASIN = /^[A-Z0-9]{10}$/;
export function fail(message, status = 400) { throw Object.assign(new Error(message), {status}); }
export function text(value, max = 500) {
  if (typeof value !== 'string') return null;
  const result = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
  return result ? result.slice(0, max) : null;
}
export function date(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('Invalid date');
  const parsed = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) fail('Invalid calendar date');
  return value;
}
export function asin(value) {
  const id = typeof value === 'string' ? value.toUpperCase() : '';
  if (!ASIN.test(id)) fail('Invalid Audible product identifier');
  return id;
}
function number(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}
export function audibleUrl(value, prefix = '/pd/') {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname === 'www.audible.com' && u.pathname.startsWith(prefix)
      ? u.origin + u.pathname : null;
  } catch { return null; }
}
export function normalize(item, source) {
  if (!item || typeof item !== 'object' || Array.isArray(item) || !SOURCES.has(source)) fail('Invalid record');
  const id = asin(item.id);
  const out = {id, title: text(item.title, 600), sourceUrl: 'https://www.audible.com/pd/' + id};
  if (source === 'library' || source === 'catalog') {
    if (!out.title) fail('Book title is required');
    out.authors = Array.isArray(item.authors) ? [...new Set(item.authors.map(x => text(x, 200)).filter(Boolean))].slice(0, 30) : [];
    out.narrators = Array.isArray(item.narrators) ? [...new Set(item.narrators.map(x => text(x, 200)).filter(Boolean))].slice(0, 30) : [];
    out.series = Array.isArray(item.series) ? item.series.slice(0, 20).map(s => ({
      id: typeof s?.id === 'string' && ASIN.test(s.id.toUpperCase()) ? s.id.toUpperCase() : null,
      name: text(s?.name, 300), position: text(s?.position, 40), url: audibleUrl(s?.url, '/series/')
    })).filter(s => s.name) : [];
    out.finished = typeof item.finished === 'boolean' ? item.finished : null;
    out.progressPercent = number(item.progressPercent, 0, 100);
    out.remainingMinutes = number(item.remainingMinutes, 0, 200000);
    out.durationMinutes = number(item.durationMinutes, 0, 200000);
    out.personalRating = number(item.personalRating, 1, 5);
    out.inLibrary = source === 'library' ? true : (typeof item.inLibrary === 'boolean' ? item.inLibrary : null);
    out.archived = null; // No archive field has been verified in the desktop interface.
    try {
      const u = new URL(item.coverUrl);
      if (u.protocol === 'https:' && ['m.media-amazon.com', 'images-na.ssl-images-amazon.com', 'images-eu.ssl-images-amazon.com', 'images-audible-com.ssl-images-amazon.com'].includes(u.hostname)) out.coverUrl = u.href;
    } catch { /* Covers are optional, never a reason to reject metadata. */ }
  } else if (source === 'purchases') {
    out.purchaseDate = date(item.purchaseDate);
    if (!out.purchaseDate) fail('Purchase date is required');
  } else if (source === 'refunds') {
    out.returnDate = date(item.returnDate);
    if (!out.returnDate) fail('Return date is required');
  } else {
    out.lastListenedDate = date(item.lastListenedDate);
    if (!out.lastListenedDate) fail('Listening date is required');
    out.progressPercent = number(item.progressPercent, 0, 100);
    out.remainingMinutes = number(item.remainingMinutes, 0, 200000);
  }
  return out;
}
export function mergeObservation(previous = {}, item, source, observedAt) {
  const book = {...previous, id: item.id, title: (source==='library'?item.title:previous.title) || item.title || previous.title || item.id, sourceUrl: item.sourceUrl};
  book.observations = {...(previous.observations || {}), [source]: {...item, observedAt}};
  if (source === 'library' || source === 'catalog') {
    // Catalog detail must not overwrite listening or library state.
    for (const field of ['title','authors','narrators','series','coverUrl','durationMinutes']) {
      if (item[field] != null && (!Array.isArray(item[field]) || item[field].length) && (source === 'library' || book[field] == null || book[field]?.length === 0)) book[field] = item[field];
    }
    if (source === 'library') {
      book.inLibrary = true; book.notSeenInLatest = false; book.librarySeenAt = observedAt;
      for (const key of ['finished','progressPercent','remainingMinutes','personalRating']) if (item[key] != null) book[key] = item[key];
    }
  }
  if (source === 'purchases' && (!book.purchaseDate || item.purchaseDate > book.purchaseDate)) book.purchaseDate = item.purchaseDate;
  if (source === 'refunds' && (!book.returnDate || item.returnDate > book.returnDate)) book.returnDate = item.returnDate;
  if (source === 'listens' && (!book.lastListenedDate || item.lastListenedDate >= book.lastListenedDate)) {
    book.lastListenedDate = item.lastListenedDate;
    book.historyProgressPercent = item.progressPercent;
    book.historyRemainingMinutes = item.remainingMinutes;
    // Only use history progress if no library observation supplies it.
    if (book.progressPercent == null) book.progressPercent = item.progressPercent;
    if (book.remainingMinutes == null) book.remainingMinutes = item.remainingMinutes;
  }
  book.ownership = book.purchaseDate
    ? (!book.returnDate || book.purchaseDate > book.returnDate ? 'purchased' : book.purchaseDate === book.returnDate ? 'uncertain' : 'returned')
    : book.returnDate ? 'returned' : book.inLibrary ? 'access_unverified' : 'catalog_only';
  book.firstSeenAt ||= observedAt;
  return book;
}
export function publicBook(book, override) {
  const {observations, ...visible} = book;
  return {...visible, localFinished: override?.finished ?? null, notes: override?.notes || '', favorite: !!override?.favorite,
    finished: override?.finished ?? book.finished ?? null, audibleFinished: book.finished ?? null,
    progressConflict: (book.finished === true && book.historyProgressPercent != null && book.historyProgressPercent < 90)};
}
export function validateTask(task) {
  if (!task || !/^[a-zA-Z0-9_-]{1,80}$/.test(task.key) || !SOURCES.has(task.source)) fail('Invalid scan task');
  return {key: task.key, source: task.source, scope: text(task.scope, 100) || 'unknown', required: task.source === 'library'};
}
