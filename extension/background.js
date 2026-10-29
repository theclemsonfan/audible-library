const ALARM = "next-chapter-weekly";
const WEEK = 7 * 24 * 60;
chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create(ALARM, { periodInMinutes: WEEK });
  await chrome.storage.local.set({ lastAttempt: null, status: "Not synced" });
});
chrome.runtime.onStartup.addListener(async () => {
  const { lastSuccess } = await chrome.storage.local.get("lastSuccess");
  if (!lastSuccess || Date.now() - lastSuccess > WEEK * 60000) await sync();
});
chrome.alarms.onAlarm.addListener(a => { if (a.name === ALARM) sync(); });
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type !== "SYNC") return;
  sync().then(respond).catch(e => respond({ ok: false, error: String(e) }));
  return true;
});
async function sync() {
  const { endpoint, token } = await chrome.storage.local.get(["endpoint", "token"]);
  if (!endpoint || !token) return { ok: false, error: "Configure private sync endpoint and token" };
  const url = new URL(endpoint);
  if (url.protocol !== "https:") return { ok: false, error: "HTTPS required" };
  await chrome.storage.local.set({ lastAttempt: Date.now(), status: "Syncing" });
  let tab;
  try {
    tab = await chrome.tabs.create({ url: "https://www.audible.com/library/titles", active: false });
    const all = new Map();
    let page = 0, next = true;
    while (next && page < 200) {
      const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectPage });
      const data = result[0]?.result;
      if (!data || !data.signedIn) throw new Error("Audible sign-in required");
      for (const book of data.books) all.set(book.id, book);
      next = data.hasNext;
      if (next) {
        const moved = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: goNext });
        if (!moved[0]?.result) throw new Error("Could not advance pagination");
        await new Promise(resolve => setTimeout(resolve, 1300));
      }
      page++;
    }
    if (next) throw new Error("Page safety limit reached");
    const payload = { schemaVersion: 1, scannedAt: new Date().toISOString(), complete: true, source: "audible-web", books: [...all.values()] };
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error("Sync endpoint HTTP " + response.status);
    await chrome.storage.local.set({ lastSuccess: Date.now(), status: "Synced " + payload.books.length + " titles", lastCount: payload.books.length });
    return { ok: true, count: payload.books.length };
  } catch (e) {
    await chrome.storage.local.set({ status: String(e.message || e) });
    return { ok: false, error: String(e.message || e) };
  } finally { if (tab?.id) await chrome.tabs.remove(tab.id).catch(() => {}); }
}
function collectPage() {
  const signedIn = !!document.querySelector('a[href*="/library"]') && !/sign.?in/i.test(document.title);
  const books = [];
  const seen = new Set();
  for (const link of document.querySelectorAll('a[href*="/pd/"]')) {
    const path = new URL(link.href).pathname;
    const id = path.match(/\/pd\/([^/?]+)/)?.[1];
    if (!id || seen.has(id)) continue;
    const title = (link.textContent || link.getAttribute("aria-label") || "").trim();
    if (!title || title.length > 240) continue;
    seen.add(id);
    const row = link.closest('[data-testid],li,article') || link.parentElement;
    const text = (row?.innerText || "").slice(0, 1200);
    books.push({ id, title, series: null, authors: [], finished: /\bFinished\b/i.test(text), timeRemaining: text.match(/\b\d+h(?: \d+m)? left\b|\b\d+m left\b/i)?.[0] || null, sourceUrl: "https://www.audible.com/pd/" + id });
  }
  const next = [...document.querySelectorAll('a,button')].find(e => /next/i.test(e.getAttribute("aria-label") || e.textContent || "") && !e.disabled && e.getAttribute("aria-disabled") !== "true");
  return { signedIn, books, hasNext: !!next };
}
function goNext() {
  const next = [...document.querySelectorAll('a,button')].find(e => /next/i.test(e.getAttribute("aria-label") || e.textContent || "") && !e.disabled && e.getAttribute("aria-disabled") !== "true");
  if (!next) return false;
  next.click();
  return true;
}
