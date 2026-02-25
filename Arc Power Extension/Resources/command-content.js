// Arc Command Bar content – integrated into ArcifySafari
// Polyfill: Safari exposes `browser`, original code used `chrome`.
if (typeof chrome === "undefined" && typeof browser !== "undefined") {
  // eslint-disable-next-line no-var
  var chrome = browser;
}

console.log("[Arc Command Bar] content.js loaded on", window.location.href);

let overlay;
let commandHistory = [];
let barData = { data: [], activeTabId: null, activeTab: null };
let dataLoadRequested = false;
let appIconUrlForResults = "";
let userHasNavigatedWithArrows = false;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "OPEN_COMMAND_BAR") {
    console.log("[Arc Command Bar] OPEN_COMMAND_BAR received");
    if (overlay) {
      overlay.remove();
      overlay = null;
      return;
    }
    openBar(msg);
  }
  if (msg.type === "COMMAND_BAR_DATA") {
    console.log("[Arc Command Bar] COMMAND_BAR_DATA received, items:", (msg.data || []).length);
    barData = {
      data: msg.data || [],
      activeTabId: msg.activeTabId ?? null,
      activeTab: msg.activeTab ?? null,
    };
    if (typeof window.__arcRefresh === "function") window.__arcRefresh();
  }
});

function openBar(payload) {
  dataLoadRequested = false;
  userHasNavigatedWithArrows = false;
  overlay = document.createElement("div");
  overlay.id = "arc-overlay";

  // Simple built-in search icon instead of loading a separate image file.
  overlay.innerHTML = `
    <div id="arc-modal">
      <div id="arc-bar-header">
        <span id="arc-bar-icon">🔍</span>
        <input id="arc-input" type="text" placeholder="Search tabs, history, or type a command…" autofocus tabindex="0" />
      </div>
      <div id="arc-results"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = document.getElementById("arc-input");
  const results = document.getElementById("arc-results");

  barData = {
    data: payload?.data || [],
    activeTabId: payload?.activeTabId ?? null,
    activeTab: payload?.activeTab ?? null,
  };

  const initialQuery = payload && payload.initialQuery;
  if (initialQuery) {
    input.value = initialQuery;
  }

  results.textContent = "Loading…";
  window.__arcRefresh = function () {
    refreshResults(input, results);
  };
  console.log("[Arc Command Bar] connecting port, requesting data");
  var port = chrome.runtime.connect({ name: "arc-command-bar" });
  var dataReceived = false;
  port.onMessage.addListener(function (msg) {
    if (msg.type === "COMMAND_BAR_DATA") {
      dataReceived = true;
      console.log("[Arc Command Bar] port message: COMMAND_BAR_DATA, items:", (msg.data || []).length);
      barData.data = msg.data || [];
      barData.activeTabId = msg.activeTabId != null ? msg.activeTabId : barData.activeTabId;
      barData.activeTab = msg.activeTab != null ? msg.activeTab : barData.activeTab;
      if (typeof window.__arcRefresh === "function") window.__arcRefresh();
    }
    try { port.disconnect(); } catch (_) {}
  });
  port.onDisconnect.addListener(function () {
    if (!dataReceived && barData.data.length === 0 && typeof window.__arcRefresh === "function") window.__arcRefresh();
  });
  port.postMessage({ type: "GET_COMMAND_BAR_DATA" });
  setTimeout(function () {
    if (!dataReceived && barData.data.length === 0 && results && results.textContent === "Loading…") {
      results.innerHTML = '<div class="arc-category">Could not load data. Type /go url or /search query</div>';
    }
  }, 4000);

  chrome.storage.local.get({ history: [] }, (res) => {
    commandHistory = res.history || [];
  });

  input.addEventListener("input", () => {
    userHasNavigatedWithArrows = false;
    const q = input.value.trim();
    if (!q) {
      showInitialSuggestions(results);
      selectFirstResult(results);
      return;
    }
    if (handleSlash(q)) return;
    if (handleAI(q)) return;
    if (barData.data.length === 0 && !dataLoadRequested) {
      dataLoadRequested = true;
      var fallbackPort = chrome.runtime.connect({ name: "arc-command-bar" });
      fallbackPort.onMessage.addListener(function (msg) {
        if (msg.type === "COMMAND_BAR_DATA") {
          barData.data = msg.data || [];
          barData.activeTabId = msg.activeTabId != null ? msg.activeTabId : barData.activeTabId;
          barData.activeTab = msg.activeTab != null ? msg.activeTab : barData.activeTab;
          refreshResults(input, results);
          selectFirstResult(results);
        }
        fallbackPort.disconnect();
      });
      fallbackPort.postMessage({ type: "GET_COMMAND_BAR_DATA" });
    }
    refreshResults(input, results);
    selectFirstResult(results);
  });

  input.addEventListener("keydown", (e) => navigate(e, input, results));
  results.addEventListener("click", (e) => {
    const searchRow = e.target.closest(".arc-search-row");
    if (searchRow?.dataset.searchQuery) openOrSearch(searchRow.dataset.searchQuery, false);
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  input.focus();
  setTimeout(() => input.focus(), 100);
  setTimeout(() => input.focus(), 300);

  function refreshResults(inputEl, resultsEl) {
    const q = inputEl.value.trim();
    if (!q) {
      showInitialSuggestions(resultsEl);
      selectFirstResult(resultsEl);
      return;
    }
    renderFuzzy(inputEl, resultsEl, q);
  }

  function selectFirstResult(resultsEl) {
    if (!resultsEl) return;
    resultsEl.querySelectorAll(".arc-selected").forEach((el) => el.classList.remove("arc-selected"));
    const first = resultsEl.querySelector(".arc-item");
    if (first) first.classList.add("arc-selected");
  }

  function showInitialSuggestions(resultsEl) {
    if (!resultsEl) return;
    const data = barData.data || [];
    resultsEl.innerHTML = "";
    if (!data.length) {
      const msg = document.createElement("div");
      msg.className = "arc-category";
      msg.textContent = "Tabs, history, bookmarks — or /close, /pin, /go, /search";
      resultsEl.appendChild(msg);
      return;
    }
    // Show a mix of tabs, history, recent, bookmarks (up to 4 per type) so all appear
    const grouped = groupByType(data);
    const typesOrder = ["tab", "history", "recent", "bookmark"];
    const perType = 6;
    const initial = [];
    for (const t of typesOrder) {
      const list = grouped[t] || [];
      initial.push(...list.slice(0, perType));
    }
    const groupedInitial = groupByType(initial);
    for (const type in groupedInitial) {
      const cat = document.createElement("div");
      cat.className = "arc-category";
      cat.textContent = type.toUpperCase();
      resultsEl.appendChild(cat);
      groupedInitial[type].forEach((item) => {
        const el = makeResultRow(item);
        el.onclick = () => execute(item);
        resultsEl.appendChild(el);
      });
    }
    const hint = document.createElement("div");
    hint.className = "arc-hint";
    hint.textContent = "Enter: go to what you typed · ↓↑ pick suggestion · Shift+Enter: current tab";
    resultsEl.appendChild(hint);
    // If we have no history or bookmarks (e.g. Safari doesn't support those APIs), show a short note
    const hasHistory = grouped.history && grouped.history.length > 0;
    const hasBookmarks = grouped.bookmark && grouped.bookmark.length > 0;
    if (!hasHistory && !hasBookmarks && (grouped.tab?.length > 0 || grouped.recent?.length > 0)) {
      const note = document.createElement("div");
      note.className = "arc-hint arc-safari-note";
      note.textContent = "History is saved as you browse. /clearhistory to clear all.";
      resultsEl.appendChild(note);
    }
  }

  function makeSearchGoogleRow(query) {
    const row = document.createElement("div");
    row.className = "arc-search-row arc-item arc-search-google";
    row.dataset.searchQuery = query;
    const iconSrc = appIconUrlForResults || chrome.runtime.getURL("icon16.png");
    row.innerHTML =
      '<span class="arc-favicon arc-favicon-app" style="background-image:url(' + escapeHtml(iconSrc) + ')"></span>' +
      '<span class="arc-item-text">' + escapeHtml("Search Google for \u201C" + query + "\u201D") + "</span>";
    row.onclick = () => openOrSearch(query);
    return row;
  }

  var POPULAR_SITES = [
    { label: "google.com", url: "https://www.google.com" },
    { label: "youtube.com", url: "https://www.youtube.com" },
    { label: "studio.youtube.com", url: "https://studio.youtube.com" },
    { label: "github.com", url: "https://github.com" },
    { label: "gmail.com", url: "https://mail.google.com" },
    { label: "twitter.com", url: "https://twitter.com" },
    { label: "facebook.com", url: "https://www.facebook.com" },
    { label: "instagram.com", url: "https://www.instagram.com" },
    { label: "reddit.com", url: "https://www.reddit.com" },
    { label: "amazon.com", url: "https://www.amazon.com" },
    { label: "wikipedia.org", url: "https://www.wikipedia.org" },
    { label: "netflix.com", url: "https://www.netflix.com" },
    { label: "linkedin.com", url: "https://www.linkedin.com" },
    { label: "stackoverflow.com", url: "https://stackoverflow.com" },
    { label: "medium.com", url: "https://medium.com" },
    { label: "apple.com", url: "https://www.apple.com" },
    { label: "microsoft.com", url: "https://www.microsoft.com" },
    { label: "spotify.com", url: "https://open.spotify.com" },
    { label: "twitch.tv", url: "https://www.twitch.tv" },
    { label: "dropbox.com", url: "https://www.dropbox.com" },
    { label: "notion.so", url: "https://www.notion.so" },
    { label: "disneyplus.com", url: "https://www.disneyplus.com" },
    { label: "canvas.liberty.edu", url: "https://canvas.liberty.edu" },
  ];

  function getPopularSuggestions(query, excludeSet) {
    var q = query.toLowerCase().trim();
    if (!q.length) return [];
    var prefix = [];
    var contains = [];
    for (var i = 0; i < POPULAR_SITES.length; i++) {
      var s = POPULAR_SITES[i];
      var lab = s.label.toLowerCase();
      if (excludeSet && excludeSet.has(lab)) continue;
      if (lab.indexOf(q) === 0) prefix.push(s);
      else if (lab.indexOf(q) !== -1) contains.push(s);
    }
    return prefix.slice(0, 10).concat(contains).slice(0, 10);
  }

  function getSuggestionsContainingQuery(query, data, excludeItems) {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    const fromHistory = (data || []).filter((i) => i.type === "history" || i.type === "bookmark" || (i.type === "tab" && i.url));
    const urls = [...new Set(fromHistory.map((i) => (i.url || "").trim()).filter(Boolean))];
    const titles = [...new Set(fromHistory.map((i) => (i.title || "").trim()).filter(Boolean))];
    const candidates = urls.concat(titles);
    const exclude = new Set();
    (excludeItems || []).forEach((m) => {
      if (m.url) exclude.add(String(m.url).toLowerCase().trim());
      if (m.title) exclude.add(String(m.title).toLowerCase().trim());
    });
    const matches = candidates.filter(
      (c) => !exclude.has(c.toLowerCase()) && (c.toLowerCase().includes(q) || q.split(/\s/).every((w) => c.toLowerCase().includes(w)))
    );
    return [...new Set(matches)].slice(0, 12);
  }

  function runFuzzySearch(query, data) {
    // Delegate to the shared fuzzy.js scorer so results behave more like a real browser address bar.
    try {
      // fuzzySearch returns items with a `score` property already attached.
      return fuzzySearch(query, data, "title");
    } catch (e) {
      console.error("[Arc Command Bar] fuzzySearch failed, falling back:", e);
      const q = String(query || "").trim();
      if (!data || !data.length) return [];
      if (!q.length) return data.slice(0, 20).map((item) => ({ ...item, score: 0 }));
      return data.map((item, idx) => ({ ...item, score: 20 - idx }));
    }
  }

  function renderFuzzy(inputEl, resultsEl, query) {
    var data = Array.isArray(barData.data) ? barData.data : [];
    resultsEl.innerHTML = "";
    if (!data.length) {
      resultsEl.appendChild(makeSearchGoogleRow(query));
      return;
    }
    chrome.storage.local.get({ arcFrecency: {} }, function (res) {
      var frecency = res.arcFrecency || {};
      function normKey(url) {
        return (url || "").trim().toLowerCase().replace(/\/+$/, "") || "";
      }
      var matches = runFuzzySearch(query, data);
      matches.forEach(function (m) {
        var key = normKey(m.url);
        var entry = frecency[key];
        if (entry) {
          var mult = frecencyMultiplier(entry.clicks, entry.lastVisited);
          m.score = (m.score || 0) * Math.max(0.3, Math.min(3, mult));
        }
      });
      matches.sort(function (a, b) {
        var d = (b.score || 0) - (a.score || 0);
        if (d !== 0) return d;
        if (a.type === "history" && b.type === "history") return (b.lastVisit || 0) - (a.lastVisit || 0);
        return 0;
      });
      var topMatches = matches.slice(0, 18);
      var hasFuzzy = topMatches.length > 0;

      var excludeForPopular = new Set();
      topMatches.forEach(function (m) {
        if (m.url) {
          var host = (m.url || "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
          excludeForPopular.add(host);
        }
        if (m.title) excludeForPopular.add((m.title || "").toLowerCase());
      });
      var popular = getPopularSuggestions(query, excludeForPopular);
      if (popular.length > 0) {
        var catPop = document.createElement("div");
        catPop.className = "arc-category";
        catPop.textContent = "AUTO-COMPLETE";
        resultsEl.appendChild(catPop);
        popular.forEach(function (s) {
          var row = document.createElement("div");
          row.className = "arc-item arc-search-row";
          row.dataset.searchQuery = s.url;
          row.innerHTML =
            '<span class="arc-favicon arc-favicon-placeholder"></span>' +
            '<span class="arc-item-text">' + (query ? highlightMatches(s.label, query) : escapeHtml(s.label)) + "</span>";
          row.onclick = function () { openOrSearch(s.url, false); };
          resultsEl.appendChild(row);
        });
      }

      if (hasFuzzy) {
        var cat = document.createElement("div");
        cat.className = "arc-category";
        cat.textContent = "BEST MATCHES";
        resultsEl.appendChild(cat);
        topMatches.forEach(function (item) {
          var el = makeResultRow(item, query);
          el.onclick = function () { execute(item); };
          resultsEl.appendChild(el);
        });
      }

      var suggestions = getSuggestionsContainingQuery(query, data, topMatches);
      if (suggestions.length > 0) {
        var cat2 = document.createElement("div");
        cat2.className = "arc-category";
        cat2.textContent = "FROM HISTORY & TABS";
        resultsEl.appendChild(cat2);
        var fromHistory = data.filter(function (i) { return i.type === "history" || i.type === "bookmark" || (i.type === "tab" && i.url); });
        suggestions.forEach(function (label) {
          var row = document.createElement("div");
          row.className = "arc-item arc-search-row";
          row.dataset.searchQuery = label;
          var hist = fromHistory.find(function (h) { return (h.url && h.url === label) || (h.title && h.title === label); });
          var fav = hist && hist.favicon
            ? '<span class="arc-favicon" style="background-image:url(' + escapeHtml(hist.favicon) + ')"></span>'
            : '<span class="arc-favicon arc-favicon-placeholder"></span>';
          row.innerHTML = fav + '<span class="arc-item-text">' + (query ? highlightMatches(label, query) : escapeHtml(label)) + "</span>";
          row.onclick = function () { openOrSearch(label, false); };
          resultsEl.appendChild(row);
        });
      }

      var searchCat = document.createElement("div");
      searchCat.className = "arc-category";
      searchCat.textContent = "SEARCH";
      resultsEl.appendChild(searchCat);
      resultsEl.appendChild(makeSearchGoogleRow(query));

      selectFirstResult(resultsEl);
    });
  }

  function makeResultRow(item, highlightQuery) {
    var el = document.createElement("div");
    el.className = "arc-item";
    el.dataset.itemType = item.type;
    if (item.type === "tab" && item.id != null) el.dataset.tabId = String(item.id);
    if (item.type === "history" && item.id) el.dataset.historyId = String(item.id);
    var faviconPart = item.favicon
      ? '<span class="arc-favicon" style="background-image:url(' + escapeHtml(item.favicon) + ')"></span>'
      : '<span class="arc-favicon arc-favicon-placeholder"></span>';
    var titlePart = highlightQuery ? highlightMatches(item.title || item.url || "Untitled", highlightQuery) : escapeHtml(item.title || item.url || "Untitled");
    var urlPart = "<span class=\"url\">" + (highlightQuery ? highlightMatches(item.url || "", highlightQuery) : escapeHtml(item.url || "")) + "</span>";
    el.innerHTML = faviconPart + "<span class=\"arc-item-text\">" + titlePart + urlPart + "</span>";
    if (item.favicon) setDominantColor(el, item.favicon);
    return el;
  }

  function setDominantColor(el, faviconDataUrl) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = function () {
      try {
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, c.width, c.height).data;
        const counts = {};
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 128) continue;
          const key = (r << 16) | (g << 8) | b;
          counts[key] = (counts[key] || 0) + 1;
        }
        let max = 0, key = 0;
        for (const k in counts) if (counts[k] > max) { max = counts[k]; key = parseInt(k, 10); }
        if (max > 0) {
          const r = (key >> 16) & 255, g = (key >> 8) & 255, b = key & 255;
          el.style.setProperty("--arc-dominant", "rgb(" + r + "," + g + "," + b + ")");
          el.classList.add("arc-has-dominant");
        }
      } catch (_) {}
    };
    img.onerror = function () {};
    img.src = faviconDataUrl;
  }

  function execute(item) {
    if (item && item.url) recordFrecency(item.url);
    if (item.type === "tab") {
      chrome.runtime.sendMessage({
        type: "EXECUTE_ACTION",
        payload: { action: "switch_tab", item },
      });
    } else if (item.type === "recent") {
      chrome.runtime.sendMessage({
        type: "EXECUTE_ACTION",
        payload: { action: "restore_session", item },
      });
    } else {
      chrome.runtime.sendMessage({
        type: "EXECUTE_ACTION",
        payload: { action: "create_tab", item },
      });
    }
    saveHistory(input.value);
    close();
  }

  function openOrSearch(query, inCurrentTab) {
    if (!query) return;
    recordFrecency(query);
    chrome.runtime.sendMessage({
      type: "OPEN_OR_SEARCH",
      payload: { query, inCurrentTab: !!inCurrentTab, tabId: barData.activeTabId },
    }, () => {});
    saveHistory(query);
    close();
  }

  function close() {
    window.__arcRefresh = null;
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
  }

  function groupByType(items) {
    return items.reduce((acc, item) => {
      if (!acc[item.type]) acc[item.type] = [];
      acc[item.type].push(item);
      return acc;
    }, {});
  }

  function navigate(e, inputEl, resultsEl) {
    const selected = document.querySelector(".arc-selected");
    const items = Array.from(document.querySelectorAll(".arc-item"));
    if (e.key === "ArrowDown") {
      e.preventDefault();
      userHasNavigatedWithArrows = true;
      const idx = selected ? items.indexOf(selected) : -1;
      const next = items[idx + 1] || items[0];
      selected?.classList.remove("arc-selected");
      if (next) next.classList.add("arc-selected");
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      userHasNavigatedWithArrows = true;
      const idx = selected ? items.indexOf(selected) : -1;
      const prev = idx <= 0 ? items[items.length - 1] : items[idx - 1];
      selected?.classList.remove("arc-selected");
      if (prev) prev.classList.add("arc-selected");
    }
    if (e.key === "Enter") {
      const typed = inputEl.value.trim();
      if (typed && !userHasNavigatedWithArrows) {
        e.preventDefault();
        openOrSearch(typed, e.shiftKey);
        close();
        return;
      }
      if (selected) {
        e.preventDefault();
        if (selected.classList.contains("arc-search-row") && selected.dataset.searchQuery) {
          openOrSearch(selected.dataset.searchQuery, e.shiftKey);
        } else {
          selected.click();
        }
      } else if (typed) {
        e.preventDefault();
        openOrSearch(typed, e.shiftKey);
        close();
      }
    }
    if (e.key === "Escape") close();
    if (e.key === "Backspace" || e.key === "Delete") {
      if (selected?.dataset.itemType === "tab" && selected?.dataset.tabId) {
        e.preventDefault();
        chrome.runtime.sendMessage({
          type: "EXECUTE_ACTION",
          payload: { action: "close_tab", item: { id: parseInt(selected.dataset.tabId, 10) } },
        }, () => {});
        close();
      } else if (selected?.dataset.itemType === "history" && selected?.dataset.historyId) {
        e.preventDefault();
        const id = selected.dataset.historyId;
        chrome.runtime.sendMessage({ type: "DELETE_HISTORY_ITEM", id }, () => {});
        barData.data = barData.data.filter((x) => !(x.type === "history" && x.id === id));
        if (typeof window.__arcRefresh === "function") window.__arcRefresh();
      }
    }
  }

  function handleSlash(q) {
    if (!q.startsWith("/")) return false;
    const cmd = q.toLowerCase();
    const known =
      cmd.startsWith("/close") ||
      cmd.startsWith("/duplicate") ||
      cmd.startsWith("/pin") ||
      cmd.startsWith("/unpin") ||
      cmd.startsWith("/mute") ||
      cmd.startsWith("/unmute") ||
      cmd.startsWith("/new") ||
      cmd.startsWith("/bookmark") ||
      cmd.startsWith("/reopen") ||
      cmd.startsWith("/clearhistory") ||
      cmd.startsWith("/go ") ||
      cmd.startsWith("/search ");
    if (!known) return false;
    const tabId = barData.activeTabId;
    if (tabId == null && !cmd.startsWith("/clearhistory")) return false;
    chrome.runtime.sendMessage(
      { type: "RUN_SLASH_COMMAND", payload: { command: q, tabId } },
      () => {}
    );
    saveHistory(q);
    close();
    return true;
  }

  function handleAI(q) {
    const s = q.toLowerCase();
    const hasOpen = s.startsWith("open ") && s.replace("open ", "").trim().length > 0;
    const hasSearch = s.startsWith("search ") && s.replace("search ", "").trim().length > 0;
    const matched =
      (s.includes("close") && s.includes("tab")) ||
      s.includes("duplicate") ||
      (s.includes("pin") && !s.includes("unpin")) ||
      s.includes("unpin") ||
      (s.includes("mute") && !s.includes("unmute")) ||
      s.includes("unmute") ||
      s.includes("new tab") ||
      s.includes("bookmark") ||
      s.includes("reopen") ||
      hasOpen ||
      hasSearch;
    if (!matched) return false;
    const tabId = barData.activeTabId;
    if (tabId == null) return false;
    chrome.runtime.sendMessage(
      { type: "RUN_AI_COMMAND", payload: { query: q, tabId } },
      () => {}
    );
    saveHistory(q);
    close();
    return true;
  }

  function saveHistory(cmd) {
    commandHistory.unshift(cmd);
    commandHistory = commandHistory.slice(0, 20);
    chrome.storage.local.set({ history: commandHistory });
  }

  var ARC_FRECENCY_KEY = "arcFrecency";

  function recordFrecency(url) {
    if (!url || typeof url !== "string") return;
    var key = url.trim().toLowerCase().replace(/\/+$/, "") || "";
    if (!key) return;
    chrome.storage.local.get({ [ARC_FRECENCY_KEY]: {} }, function (res) {
      var map = res[ARC_FRECENCY_KEY] || {};
      var entry = map[key] || { clicks: 0, lastVisited: 0 };
      entry.clicks = (entry.clicks || 0) + 1;
      entry.lastVisited = Date.now();
      map[key] = entry;
      var out = {};
      out[ARC_FRECENCY_KEY] = map;
      chrome.storage.local.set(out);
    });
  }

  function frecencyMultiplier(clicks, lastVisited) {
    var days = lastVisited ? (Date.now() - lastVisited) / (24 * 60 * 60 * 1000) : 999;
    return (Math.log((clicks || 0) + 1) + 1) / (days + 1);
  }
}

function escapeHtml(text) {
  if (!text) return "";
  var div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function highlightMatches(text, query) {
  if (!text) return "";
  var safe = escapeHtml(text);
  if (!query || !query.trim()) return safe;
  var q = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var re = new RegExp("(" + q + ")", "gi");
  return safe.replace(re, "<mark>$1</mark>");
}

