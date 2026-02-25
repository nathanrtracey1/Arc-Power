// Packaged copy – Arc Command Bar background (see source in ArcifySafari Extension/arc-command-background.js)
if (typeof chrome === "undefined" && typeof browser !== "undefined") {
  var chrome = browser;
}

console.log("[Arc Command Bar] background.js loaded");

const HISTORY_STORAGE_KEY = "arcPageHistory";
const HISTORY_GC_LAST_KEY = "arcHistoryGCLastRun";
const FAVICON_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PENDING_NAV_KEY = "arcPendingNav";

const STRIP_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "ref", "referrer", "source", "fbclid", "gclid", "msclkid",
  "page", "p", "offset", "start", "session_id", "si",
  "_ga", "mc_cid", "mc_eid", "_hsenc", "hsa_acc", "hsa_cam", "hsa_grp", "hsa_ad", "hsa_src", "hsa_tgt", "hsa_kw", "hsa_mt", "hsa_net", "hsa_ver"
]);

const JUNK_PATH_PATTERNS = /^\/(track|tracking|redirect|out|go|click|r|ref)\b|\.(php|asp|aspx|cgi)(\?|$)/i;
const INDEX_FILES = /\/index\.(html?|php|asp|aspx|cgi)(\?|$)/i;

function normalizeUrlForStorage(url) {
  if (!url || typeof url !== "string") return { url: "", clean: "", isJunk: true };
  let u;
  try {
    u = new URL(url);
  } catch (_) {
    return { url: url.slice(0, 500), clean: "", isJunk: true };
  }
  if (!u.protocol.startsWith("http")) return { url: u.href, clean: "", isJunk: true };

  const params = u.searchParams;
  STRIP_PARAMS.forEach((p) => params.delete(p));
  u.search = params.toString();
  let path = u.pathname.replace(/\/+$/, "") || "/";
  path = path.replace(INDEX_FILES, "/");
  u.pathname = path;
  let clean = u.href.replace(/\/$/, "") || u.origin + "/";
  if (clean.endsWith("/") && clean.length > u.origin.length + 1) clean = clean.slice(0, -1);

  const isJunk = JUNK_PATH_PATTERNS.test(u.pathname) || params.has("utm_") || /^https?:\/\/(localhost|127\.)/i.test(clean);
  return { url: u.href, clean, isJunk };
}

function idFromUrl(url) {
  try {
    const u = new URL(url);
    return btoa(u.origin + u.pathname.replace(/\/$/, "") || u.origin).replace(/[+/=]/g, "_").slice(0, 32);
  } catch (_) {
    return "id_" + Math.random().toString(36).slice(2, 12);
  }
}

function historyScore(entry) {
  const visits = entry.visitCount || 1;
  const daysSince = (Date.now() - (entry.lastVisit || 0)) / (24 * 60 * 60 * 1000);
  return visits / Math.pow(1 + daysSince, 0.7);
}

async function getStoredHistory() {
  const { [HISTORY_STORAGE_KEY]: list = [] } = await chrome.storage.local.get(HISTORY_STORAGE_KEY);
  const scored = list.map((e) => ({ ...e, _score: historyScore(e) }));
  scored.sort((a, b) => b._score - a._score);
  return scored;
}

async function runHistoryGC() {
  const { [HISTORY_STORAGE_KEY]: list = [], [HISTORY_GC_LAST_KEY]: last = 0 } = await chrome.storage.local.get([HISTORY_STORAGE_KEY, HISTORY_GC_LAST_KEY]);
  if (Date.now() - last < GC_INTERVAL_MS && list.length > 0) return;
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const kept = list.filter((e) => e.visitCount >= 2 || (e.lastVisit || 0) >= cutoff);
  await chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: kept, [HISTORY_GC_LAST_KEY]: Date.now() });
}

async function recordVisit({ url, title, typedUrl }) {
  const norm = normalizeUrlForStorage(url);
  if (norm.isJunk) return;
  const id = idFromUrl(norm.clean);
  const now = Date.now();

  const { [HISTORY_STORAGE_KEY]: list = [] } = await chrome.storage.local.get(HISTORY_STORAGE_KEY);
  let entry = list.find((e) => e.id === id);
  if (!entry) {
    entry = {
      id,
      title: (title || norm.clean || "Untitled").slice(0, 200),
      url: norm.clean.slice(0, 500),
      visitCount: 0,
      lastVisit: 0,
      firstVisit: now,
      favicon: null,
      faviconStoredAt: 0,
    };
    list.push(entry);
  }
  entry.visitCount = (entry.visitCount || 0) + 1;
  entry.lastVisit = now;
  entry.title = (title || entry.title || norm.clean || "Untitled").slice(0, 200);

  if (typedUrl && typedUrl !== norm.clean) {
    const typedNorm = normalizeUrlForStorage(typedUrl);
    if (!typedNorm.isJunk && typedNorm.clean !== norm.clean) {
      const typedId = idFromUrl(typedNorm.clean);
      let typedEntry = list.find((e) => e.id === typedId);
      if (!typedEntry) {
        typedEntry = {
          id: typedId,
          title: entry.title,
          url: typedNorm.clean.slice(0, 500),
          visitCount: 0,
          lastVisit: now,
          firstVisit: now,
          favicon: null,
          faviconStoredAt: 0,
        };
        list.push(typedEntry);
      }
      typedEntry.visitCount = (typedEntry.visitCount || 0) + 1;
      typedEntry.lastVisit = now;
      typedEntry.title = (title || typedEntry.title || "Untitled").slice(0, 200);
    }
  }

  await chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: list });
}

async function ensureFavicon(entry) {
  if (entry.favicon && entry.faviconStoredAt && Date.now() - entry.faviconStoredAt < FAVICON_TTL_MS) return entry;
  try {
    const u = new URL(entry.url);
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`;
    const r = await fetch(faviconUrl);
    if (!r.ok) return entry;
    const blob = await r.blob();
    const dataUrl = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result);
      reader.onerror = rej;
      reader.readAsDataURL(blob);
    });
    const list = (await chrome.storage.local.get(HISTORY_STORAGE_KEY))[HISTORY_STORAGE_KEY] || [];
    const idx = list.findIndex((e) => e.id === entry.id);
    if (idx >= 0) {
      const storedAt = Date.now();
      list[idx].favicon = dataUrl;
      list[idx].faviconStoredAt = storedAt;
      await chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: list });
      return { ...entry, favicon: dataUrl, faviconStoredAt: storedAt };
    }
    return entry;
  } catch (_) {
    return entry;
  }
}

async function deleteHistoryItem(id) {
  const { [HISTORY_STORAGE_KEY]: list = [] } = await chrome.storage.local.get(HISTORY_STORAGE_KEY);
  const next = list.filter((e) => e.id !== id);
  await chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: next });
}

async function clearAllHistory() {
  await chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: [], [HISTORY_GC_LAST_KEY]: 0 });
}

let pendingNavByTab = {};

chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (change.url && tab.status === "loading") {
    pendingNavByTab[tabId] = change.url;
  }
  if (change.status === "complete" && tab.url && tab.title !== undefined) {
    const typedUrl = pendingNavByTab[tabId];
    delete pendingNavByTab[tabId];
    await recordVisit({
      url: tab.url,
      title: tab.title,
      typedUrl: typedUrl && typedUrl !== tab.url ? typedUrl : undefined,
    });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open-command-bar") return;
  console.log("[Arc Command Bar] ⌘K received");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      console.log("[Arc Command Bar] no active tab id");
      return;
    }
    console.log("[Arc Command Bar] sending OPEN_COMMAND_BAR to tab", tab.id);
    chrome.tabs.sendMessage(tab.id, {
      type: "OPEN_COMMAND_BAR",
      activeTabId: tab.id,
      activeTab: { id: tab.id, title: tab.title, url: tab.url },
    });
  } catch (e) {
    console.error("[Arc Command Bar] Command failed:", e);
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "arc-command-bar") return;
  console.log("[Arc Command Bar] port connected:", port.name);
  port.onMessage.addListener((msg) => {
    if (msg.type !== "GET_COMMAND_BAR_DATA") return;
    console.log("[Arc Command Bar] GET_COMMAND_BAR_DATA via port");
    getCommandBarData()
      .then((payload) => {
        console.log("[Arc Command Bar] getCommandBarData done, items:", (payload.data || []).length);
        port.postMessage({ type: "COMMAND_BAR_DATA", ...payload });
      })
      .catch((err) => {
        console.error("[Arc Command Bar] getCommandBarData failed:", err);
        port.postMessage({ type: "COMMAND_BAR_DATA", data: [], activeTabId: null, activeTab: null });
      });
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_COMMAND_BAR_DATA") {
    getCommandBarData()
      .then(sendResponse)
      .catch((err) => {
        console.error("[Arc Command Bar] getCommandBarData failed:", err);
        sendResponse({ error: String(err), data: [], activeTabId: null, activeTab: null });
      });
    return true;
  }

  if (message.type === "EXECUTE_ACTION") {
    executeAction(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error("[Arc Command Bar] executeAction failed:", err);
        sendResponse({ ok: false, error: String(err) });
      });
    return true;
  }

  if (message.type === "RUN_SLASH_COMMAND") {
    runSlashCommand(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error("[Arc Command Bar] runSlashCommand failed:", err);
        sendResponse({ ok: false, error: String(err) });
      });
    return true;
  }

  if (message.type === "RUN_AI_COMMAND") {
    runAICommand(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error("[Arc Command Bar] runAICommand failed:", err);
        sendResponse({ ok: false, error: String(err) });
      });
    return true;
  }

  if (message.type === "OPEN_OR_SEARCH") {
    openUrlOrSearch(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error("[Arc Command Bar] openUrlOrSearch failed:", err);
        sendResponse({ ok: false, error: String(err) });
      });
    return true;
  }

  if (message.type === "DELETE_HISTORY_ITEM") {
    deleteHistoryItem(message.id)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error("[Arc Command Bar] deleteHistoryItem failed:", err);
        sendResponse({ ok: false, error: String(err) });
      });
    return true;
  }

  if (message.type === "CLEAR_ALL_HISTORY") {
    clearAllHistory()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error("[Arc Command Bar] clearAllHistory failed:", err);
        sendResponse({ ok: false, error: String(err) });
      });
    return true;
  }

  if (message.type === "OPEN_COMMAND_BAR_FROM_SIDEBAR") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
          sendResponse({ ok: false, error: "No active tab" });
          return;
        }
        chrome.tabs.sendMessage(tab.id, {
          type: "OPEN_COMMAND_BAR",
          activeTabId: tab.id,
          activeTab: { id: tab.id, title: tab.title, url: tab.url },
          initialQuery: message.initialQuery !== undefined && message.initialQuery !== null ? message.initialQuery : tab.url,
        });
        sendResponse({ ok: true });
      } catch (e) {
        console.error("[Arc Command Bar] OPEN_COMMAND_BAR_FROM_SIDEBAR failed:", e);
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
});

async function getCommandBarData() {
  await runHistoryGC();
  let activeTab = null;
  let tabs = [];
  let sessions = [];
  let bookmarks = [];
  let storedHistory = [];

  try {
    [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabs = await chrome.tabs.query({ currentWindow: true });
    if (tabs.length <= 1) {
      const allTabs = await chrome.tabs.query({});
      if (allTabs.length > tabs.length) tabs = allTabs;
    }
    console.log("[Arc Command Bar] tabs count:", tabs.length);
  } catch (e) {
    console.error("[Arc Command Bar] tabs failed:", e);
  }

  try {
    storedHistory = await getStoredHistory();
    const top = storedHistory.slice(0, 80);
    for (let i = 0; i < top.length; i++) {
      top[i] = await ensureFavicon(top[i]);
    }
    storedHistory = top;
    console.log("[Arc Command Bar] stored history count:", storedHistory.length);
  } catch (e) {
    console.error("[Arc Command Bar] stored history failed:", e);
  }

  try {
    if (chrome.sessions && typeof chrome.sessions.getRecentlyClosed === "function") {
      sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 15 });
    }
    console.log("[Arc Command Bar] recently closed count:", (sessions || []).filter((s) => s.tab).length);
  } catch (e) {
    console.error("[Arc Command Bar] sessions failed:", e);
  }

  try {
    if (chrome.bookmarks && typeof chrome.bookmarks.getTree === "function") {
      const tree = await chrome.bookmarks.getTree();
      bookmarks = flattenBookmarks(tree).filter((b) => b.url).slice(0, 50);
    }
    console.log("[Arc Command Bar] bookmarks count:", bookmarks.length);
  } catch (e) {
    console.error("[Arc Command Bar] bookmarks failed:", e);
  }

  const recentlyClosed = (sessions || [])
    .filter((s) => s.tab)
    .map((s) => ({
      type: "recent",
      title: s.tab.title || s.tab.url || "Untitled",
      url: s.tab.url,
      sessionId: s.tab.sessionId,
    }));

  const historyByUrl = new Map(storedHistory.map((h) => [h.url, h]));

  const tabsList = tabs.map((t) => {
    const tUrl = (t.url || "").slice(0, 500);
    const norm = normalizeUrlForStorage(tUrl);
    const hist = historyByUrl.get(norm.clean) || historyByUrl.get(tUrl);
    return {
      type: "tab",
      title: (t.title || t.url || "Untitled").slice(0, 200),
      url: tUrl,
      id: t.id,
      pinned: !!t.pinned,
      favicon: hist?.favicon || t.favIconUrl || null,
    };
  });

  const historyList = storedHistory.map((h) => ({
    type: "history",
    id: h.id,
    title: (h.title || h.url || "Untitled").slice(0, 200),
    url: (h.url || "").slice(0, 500),
    visitCount: h.visitCount,
    lastVisit: h.lastVisit,
    favicon: h.favicon || null,
  }));

  const bookmarksList = bookmarks.map((b) => ({
    type: "bookmark",
    title: (b.title || b.url || "Untitled").slice(0, 200),
    url: (b.url || "").slice(0, 500),
  }));
  const data = [...tabsList, ...historyList, ...recentlyClosed, ...bookmarksList];

  return {
    data,
    activeTabId: activeTab?.id ?? null,
    activeTab: activeTab
      ? { id: activeTab.id, title: activeTab.title, url: activeTab.url }
      : null,
  };
}

function flattenBookmarks(nodes) {
  const out = [];
  for (const node of nodes) {
    if (node.url) out.push({ title: node.title, url: node.url });
    if (node.children) out.push(...flattenBookmarks(node.children));
  }
  return out;
}

async function executeAction(payload) {
  const { action, item } = payload;
  if (action === "switch_tab" && item?.id) {
    await chrome.tabs.update(item.id, { active: true });
  } else if (action === "restore_session" && item?.sessionId) {
    await chrome.sessions.restore(item.sessionId);
  } else if (action === "create_tab" && item?.url) {
    await chrome.tabs.create({ url: item.url });
  } else if (action === "close_tab" && item?.id) {
    await chrome.tabs.remove(item.id);
  }
}

async function runSlashCommand(payload) {
  const { command, tabId } = payload;
  const cmd = (command || "").toLowerCase();
  if (cmd.startsWith("/clearhistory")) {
    await clearAllHistory();
    return;
  }
  if (!tabId) return;
  if (cmd.startsWith("/close")) {
    await chrome.tabs.remove(tabId);
  } else if (cmd.startsWith("/duplicate")) {
    await chrome.tabs.duplicate(tabId);
  } else if (cmd.startsWith("/pin")) {
    await chrome.tabs.update(tabId, { pinned: true });
  } else if (cmd.startsWith("/unpin")) {
    await chrome.tabs.update(tabId, { pinned: false });
  } else if (cmd.startsWith("/mute")) {
    await chrome.tabs.update(tabId, { muted: true });
  } else if (cmd.startsWith("/unmute")) {
    await chrome.tabs.update(tabId, { muted: false });
  } else if (cmd.startsWith("/new")) {
    await chrome.tabs.create({});
  } else if (cmd.startsWith("/bookmark")) {
    const tab = await chrome.tabs.get(tabId);
    await chrome.bookmarks.create({ title: tab.title || tab.url, url: tab.url });
  } else if (cmd.startsWith("/reopen")) {
    await chrome.sessions.restore();
  } else if (cmd.startsWith("/go ")) {
    const url = normalizeUrl(cmd.replace("/go ", "").trim());
    await chrome.tabs.create({ url });
  } else if (cmd.startsWith("/search ")) {
    const q = cmd.replace("/search ", "").trim();
    await chrome.tabs.create({ url: `https://www.google.com/search?q=${encodeURIComponent(q)}` });
  }
}

async function runAICommand(payload) {
  const { query, tabId } = payload;
  if (!tabId) return;
  const s = query.toLowerCase();
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;

  if (s.includes("close") && s.includes("tab")) {
    await chrome.tabs.remove(tabId);
  } else if (s.includes("duplicate")) {
    await chrome.tabs.duplicate(tabId);
  } else if (s.includes("pin") && !s.includes("unpin")) {
    await chrome.tabs.update(tabId, { pinned: true });
  } else if (s.includes("unpin")) {
    await chrome.tabs.update(tabId, { pinned: false });
  } else if (s.includes("mute") && !s.includes("unmute")) {
    await chrome.tabs.update(tabId, { muted: true });
  } else if (s.includes("unmute")) {
    await chrome.tabs.update(tabId, { muted: false });
  } else if (s.includes("new tab")) {
    await chrome.tabs.create({});
  } else if (s.includes("bookmark")) {
    await chrome.bookmarks.create({ title: tab.title || tab.url, url: tab.url });
  } else if (s.includes("reopen")) {
    await chrome.sessions.restore();
  } else if (s.startsWith("open ")) {
    const url = normalizeUrl(s.replace("open ", "").trim());
    await chrome.tabs.create({ url });
  } else if (s.startsWith("search ")) {
    const q = s.replace("search ", "").trim();
    await chrome.tabs.create({ url: `https://www.google.com/search?q=${encodeURIComponent(q)}` });
  }
}

function normalizeUrl(u) {
  const t = u.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

async function openUrlOrSearch(payload) {
  const q = (payload?.query || "").trim();
  if (!q) return;
  const url = /^https?:\/\//i.test(q) || /^[a-z0-9-]+\.[a-z]{2,}(\/|$)/i.test(q) || q.includes(".")
    ? normalizeUrl(q)
    : `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  const inCurrentTab = !!payload?.inCurrentTab;
  let tabId = payload?.tabId;
  if (inCurrentTab) {
    if (!tabId) {
      const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = t?.id;
    }
    if (tabId) {
      await chrome.tabs.update(tabId, { url });
      return;
    }
  }
  await chrome.tabs.create({ url });
}

