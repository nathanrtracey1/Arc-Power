// background.js – Tabs, storage, folders, favorites, space icon/theme. No archiving.

const ctx = typeof browser !== "undefined" ? browser : chrome;
let rightClickContext = null;

function setRightClickContext(context) {
  rightClickContext = context;
}

const ARCIFY_ROOT = "arcify";
const MOVE_PREFIX = "arcify-move-";

function buildContextMenus() {
  if (!ctx.contextMenus) return;
  ctx.contextMenus.removeAll(() => {
    ctx.contextMenus.create({ id: ARCIFY_ROOT, title: "Arc Power", contexts: ["all"], visible: false });
    ctx.contextMenus.create({ id: "arcify-copy", parentId: ARCIFY_ROOT, title: "Copy Link", contexts: ["all"] });
    ctx.contextMenus.create({ id: "arcify-duplicate", parentId: ARCIFY_ROOT, title: "Duplicate", contexts: ["all"] });
    ctx.contextMenus.create({ id: "arcify-pin", parentId: ARCIFY_ROOT, title: "Pin", contexts: ["all"] });
    ctx.contextMenus.create({ id: "arcify-fav", parentId: ARCIFY_ROOT, title: "Add to Favorites", contexts: ["all"] });
    ctx.contextMenus.create({ id: "arcify-rename", parentId: ARCIFY_ROOT, title: "Rename Tab", contexts: ["all"] });
    ctx.contextMenus.create({ id: "arcify-editurl", parentId: ARCIFY_ROOT, title: "Edit URL", contexts: ["all"] });
    ctx.contextMenus.create({ id: "arcify-remove-folder", parentId: ARCIFY_ROOT, title: "Remove from folder", contexts: ["all"] });
    ctx.contextMenus.create({ id: "arcify-folder-rename", parentId: ARCIFY_ROOT, title: "Rename folder", contexts: ["all"] });
    ctx.contextMenus.create({ id: "arcify-folder-remove", parentId: ARCIFY_ROOT, title: "Remove folder", contexts: ["all"] });
    ctx.contextMenus.create({ id: "arcify-space-edit", parentId: ARCIFY_ROOT, title: "Edit space", contexts: ["all"] });
    ctx.contextMenus.create({ id: "arcify-space-remove", parentId: ARCIFY_ROOT, title: "Remove space", contexts: ["all"] });
    ctx.contextMenus.create({ id: "arcify-fav-remove", parentId: ARCIFY_ROOT, title: "Remove from Favorites", contexts: ["all"] });
  });
}

async function updateContextMenuForContext(context) {
  if (!ctx.contextMenus) return;
  const hide = (id) => ctx.contextMenus.update(id, { visible: false }).catch(() => {});
  const show = (id, opts) => ctx.contextMenus.update(id, { visible: true, ...opts }).catch(() => {});

  if (!context) {
    await ctx.contextMenus.update(ARCIFY_ROOT, { visible: false });
    return;
  }

  await ctx.contextMenus.update(ARCIFY_ROOT, { visible: true });
  const tabIds = ["arcify-copy", "arcify-duplicate", "arcify-pin", "arcify-fav", "arcify-rename", "arcify-editurl", "arcify-remove-folder"];
  const folderIds = ["arcify-folder-rename", "arcify-folder-remove"];
  const spaceIds = ["arcify-space-edit", "arcify-space-remove"];
  const favIds = ["arcify-fav-remove"];

  const removeMoveItems = () => {
    return new Promise((resolve) => {
      if (!ctx.contextMenus.getAll) return resolve();
      ctx.contextMenus.getAll((items) => {
        const moveIds = (items || []).filter((i) => i.id && String(i.id).startsWith(MOVE_PREFIX)).map((i) => i.id);
        Promise.all(moveIds.map((id) => ctx.contextMenus.remove(id))).then(() => resolve());
      });
    });
  };

  if (context.type === "tab") {
    await removeMoveItems();
    for (const id of tabIds) await show(id);
    await show("arcify-pin", { title: context.pinned ? "Remove Pin" : "Pin" });
    await show("arcify-fav", { title: context.inFav ? "Remove from Favorites" : "Add to Favorites" });
    await show("arcify-remove-folder", context.inFolder ? {} : { visible: false });
    for (const id of folderIds.concat(spaceIds).concat(favIds)) await hide(id);
    if (context.folderNames && context.folderNames.length) {
      for (const fn of context.folderNames) {
        if (fn === context.inFolder) continue;
        await ctx.contextMenus.create({ id: MOVE_PREFIX + String(fn).replace(/\s/g, "_"), parentId: ARCIFY_ROOT, title: fn, contexts: ["all"] });
      }
      await ctx.contextMenus.create({ id: MOVE_PREFIX + "new", parentId: ARCIFY_ROOT, title: "+ New folder…", contexts: ["all"] });
    }
  } else {
    await removeMoveItems();
    if (context.type === "folder") {
      for (const id of tabIds) await hide(id);
      for (const id of folderIds) await show(id);
      for (const id of spaceIds.concat(favIds)) await hide(id);
    } else if (context.type === "space") {
      for (const id of tabIds.concat(folderIds)) await hide(id);
      await show("arcify-space-edit");
      await show("arcify-space-remove", context.canRemove ? {} : { visible: false });
      for (const id of favIds) await hide(id);
    } else if (context.type === "favorite") {
      for (const id of tabIds.concat(folderIds).concat(spaceIds)) await hide(id);
      await show("arcify-fav-remove");
    }
  }
}

const SPACE_ICONS = ["◇", "◆", "●", "★", "▲", "▸", "◇", "○"];
const DEFAULT_SETTINGS = {
  defaultSearchEngine: "google",
  enableKeywordTabSearch: true,
  customKeywordServices: [],
  autoSmartRenamePinned: false,
};
const DEFAULT_STATE = {
  spaces: {
    Default: {
      pinned: [],
      folders: {},
      tabs: [],
      favorites: [],
      icon: "◇",
      theme: "default",
      color: null
    }
  },
  currentSpace: "Default",
  lastActiveByTabId: {},
  updatedAt: 0,
  sidebarWidth: 280,
  settings: DEFAULT_SETTINGS,
};

const CLOUD_STATE_KEY = "ArcPowerStateV1";
const SNAPSHOT_STORAGE_KEY = "ArcPowerSnapshotsV1";

const NATIVE_APP_NAMES = (() => {
  try {
    const m = browser.runtime && typeof browser.runtime.getManifest === "function" ? browser.runtime.getManifest() : null;
    const name = m && m.name;
    const names = [name, "Arc Power"].filter(Boolean);
    return Array.from(new Set(names));
  } catch (_) {
    return ["Arc Power"];
  }
})();

async function sendNativeSync(command, payload = {}) {
  if (!browser.runtime || typeof browser.runtime.sendNativeMessage !== "function") {
    throw new Error("sendNativeMessage unsupported");
  }
  let lastErr = null;
  for (const name of NATIVE_APP_NAMES) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await browser.runtime.sendNativeMessage(name, { command, ...payload });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("sendNativeMessage failed");
}

async function syncGetStateFromCloud() {
  try {
    const resp = await sendNativeSync("sync-get-state");
    const json = resp && typeof resp.stateJson === "string" ? resp.stateJson : null;
    if (!json) return null;
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

async function syncPutStateToCloud(state) {
  try {
    const json = JSON.stringify(state || {});
    await sendNativeSync("sync-put-state", { stateJson: json, key: CLOUD_STATE_KEY });
  } catch (_) {
    // Best-effort; ignore sync errors.
  }
}

async function loadSnapshots() {
  const data = await browser.storage.local.get(SNAPSHOT_STORAGE_KEY);
  const snapshots = data[SNAPSHOT_STORAGE_KEY] || {};
  return snapshots;
}

async function saveSnapshots(snapshots) {
  await browser.storage.local.set({ [SNAPSHOT_STORAGE_KEY]: snapshots || {} });
}

function migrateSpace(space) {
  if (!space.folders) space.folders = {};
  if (!space.favorites) space.favorites = [];
  if (!Array.isArray(space.pinned)) space.pinned = [];
  if (!Array.isArray(space.tabs)) space.tabs = [];
  if (!space.icon) space.icon = SPACE_ICONS[Object.keys(space).length % SPACE_ICONS.length] || "◇";
  if (!space.theme) space.theme = "default";
  if (space.color === undefined) space.color = null;
  if (space.gradient === undefined) space.gradient = null;
  if (!space.layout) space.layout = "list";
  return space;
}

function migrateSettings(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    defaultSearchEngine: typeof s.defaultSearchEngine === "string" ? s.defaultSearchEngine : DEFAULT_SETTINGS.defaultSearchEngine,
    enableKeywordTabSearch: s.enableKeywordTabSearch === false ? false : true,
    customKeywordServices: Array.isArray(s.customKeywordServices) ? s.customKeywordServices : [],
    autoSmartRenamePinned: s.autoSmartRenamePinned === true ? true : false,
  };
}

async function getState() {
  const data = await browser.storage.local.get([
    "spaces",
    "currentSpace",
    "lastActiveByTabId",
    "updatedAt",
    "sidebarWidth",
    "settings",
  ]);
  let localState = {
    spaces: data.spaces || DEFAULT_STATE.spaces,
    currentSpace: data.currentSpace || DEFAULT_STATE.currentSpace,
    lastActiveByTabId: data.lastActiveByTabId || {},
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
    sidebarWidth:
      typeof data.sidebarWidth === "number"
        ? Math.min(400, Math.max(200, data.sidebarWidth))
        : DEFAULT_STATE.sidebarWidth,
    settings: migrateSettings(data.settings || DEFAULT_STATE.settings),
  };
  Object.keys(localState.spaces).forEach((name) => {
    localState.spaces[name] = migrateSpace(localState.spaces[name]);
  });

  const cloudState = await syncGetStateFromCloud();
  let chosen = localState;
  if (cloudState && typeof cloudState === "object") {
    const cloudUpdated = typeof cloudState.updatedAt === "number" ? cloudState.updatedAt : 0;
    const localUpdated = typeof localState.updatedAt === "number" ? localState.updatedAt : 0;
    if (cloudUpdated > localUpdated) {
      chosen = {
        spaces: cloudState.spaces || DEFAULT_STATE.spaces,
        currentSpace: cloudState.currentSpace || DEFAULT_STATE.currentSpace,
        lastActiveByTabId: cloudState.lastActiveByTabId || {},
        updatedAt: cloudUpdated,
        sidebarWidth:
          typeof cloudState.sidebarWidth === "number"
            ? Math.min(400, Math.max(200, cloudState.sidebarWidth))
            : localState.sidebarWidth,
        settings: migrateSettings(cloudState.settings || localState.settings),
      };
      Object.keys(chosen.spaces).forEach((name) => {
        chosen.spaces[name] = migrateSpace(chosen.spaces[name]);
      });
      await browser.storage.local.set({
        spaces: chosen.spaces,
        currentSpace: chosen.currentSpace,
        lastActiveByTabId: chosen.lastActiveByTabId,
        updatedAt: chosen.updatedAt,
        sidebarWidth: chosen.sidebarWidth,
        settings: chosen.settings,
      });
    }
  }
  return chosen;
}

async function saveState(state) {
  const next = state || DEFAULT_STATE;
  next.updatedAt = Date.now();
  if (typeof next.sidebarWidth !== "number") next.sidebarWidth = DEFAULT_STATE.sidebarWidth;
  next.sidebarWidth = Math.min(400, Math.max(200, next.sidebarWidth));
  next.settings = migrateSettings(next.settings || DEFAULT_STATE.settings);
  await browser.storage.local.set({
    spaces: next.spaces,
    currentSpace: next.currentSpace,
    lastActiveByTabId: next.lastActiveByTabId || {},
    updatedAt: next.updatedAt,
    sidebarWidth: next.sidebarWidth,
    settings: next.settings,
  });
  await syncPutStateToCloud(next);
}

function getTabs() {
  return browser.tabs.query({ currentWindow: true });
}

function markTabActive(tabId) {
  return browser.storage.local.get(["lastActiveByTabId"]).then((data) => {
    const last = data.lastActiveByTabId || {};
    last[tabId] = Date.now();
    return browser.storage.local.set({ lastActiveByTabId: last });
  });
}

let refreshTimeout = null;
function broadcastRefresh() {
  if (refreshTimeout) clearTimeout(refreshTimeout);
  refreshTimeout = setTimeout(() => {
    refreshTimeout = null;
    browser.tabs.query({ currentWindow: true }).then((tabs) => {
      tabs.forEach((tab) => {
        browser.tabs.sendMessage(tab.id, { action: "refreshTabs" }).catch(() => {});
      });
    });
  }, 150);
}

browser.tabs.onActivated.addListener((activeInfo) => {
  markTabActive(activeInfo.tabId);
});
browser.tabs.onCreated.addListener(() => broadcastRefresh());
browser.tabs.onRemoved.addListener(() => broadcastRefresh());
browser.tabs.onUpdated.addListener(() => broadcastRefresh());

function tryTogglePanel(tabId) {
  return browser.tabs.sendMessage(tabId, { action: "togglePanel" }).catch(() => {
    return browser.tabs.executeScript(tabId, { file: "content.js" })
      .then(() => browser.tabs.insertCSS(tabId, { file: "ui.css" }).catch(() => {}))
      .then(() => browser.tabs.sendMessage(tabId, { action: "togglePanel" }))
      .catch(() => {});
  });
}

browser.browserAction.onClicked.addListener((tab) => {
  tryTogglePanel(tab.id);
});

browser.commands.onCommand.addListener((command) => {
  if (command === "toggle-panel") {
    browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (tabs[0]) tryTogglePanel(tabs[0].id);
    });
  }
});

buildContextMenus();

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const run = async () => {
    switch (message.action) {
      case "setRightClickContext":
        setRightClickContext(message.context || null);
        await updateContextMenuForContext(message.context || null);
        return { ok: true };

      case "getState":
        return await getState();

      case "saveSnapshot": {
        const name = (message.name || "").trim();
        if (!name) return { ok: false, error: "Snapshot name required" };
        const state = await getState();
        const snapshots = await loadSnapshots();
        snapshots[name] = state;
        await saveSnapshots(snapshots);
        return { ok: true };
      }

      case "listSnapshots": {
        const snapshots = await loadSnapshots();
        return { snapshots };
      }

      case "restoreSnapshot": {
        const name = (message.name || "").trim();
        if (!name) return { ok: false, error: "Snapshot name required" };
        const snapshots = await loadSnapshots();
        const snap = snapshots[name];
        if (!snap) return { ok: false, error: "Snapshot not found" };
        await saveState(snap);
        return await getState();
      }

      case "switchSpaceByName": {
        const query = (message.spaceNameQuery || "").trim().toLowerCase();
        if (!query) return await getState();
        const state = await getState();
        const names = Object.keys(state.spaces || {});
        if (!names.length) return state;
        const lower = names.map((n) => n.toLowerCase());
        let idx = lower.indexOf(query);
        if (idx === -1) idx = lower.findIndex((n) => n.startsWith(query));
        if (idx === -1) idx = lower.findIndex((n) => n.includes(query));
        if (idx === -1) return state;
        state.currentSpace = names[idx];
        await saveState(state);
        broadcastRefresh();
        return state;
      }

      case "loadTabs": {
        let state = await getState();
        const tabs = await getTabs();
        const space = state.spaces[state.currentSpace] || {
          pinned: [],
          folders: {},
          tabs: [],
          favorites: [],
          icon: "◇",
          theme: "default"
        };
        migrateSpace(space);
        const tabMap = {};
        [...space.pinned, ...space.tabs, ...Object.values(space.folders).flat()].forEach((t) => (tabMap[t.id] = t));
        const activeTabId = tabs.find((t) => t.active)?.id;
        // Build sets of IDs already managed in pinned/folders so loadTabs never
        // duplicates those tabs back into space.tabs.
        const pinnedIds = new Set((space.pinned || []).map((t) => t && t.id).filter((id) => id != null));
        const folderIds = new Set(Object.values(space.folders || {}).flat().map((t) => t && t.id).filter((id) => id != null));
        space.tabs = tabs
          .filter((t) => !pinnedIds.has(t.id) && !folderIds.has(t.id))
          .map((t) => {
            const existing = tabMap[t.id];
            const base = {
              id: t.id,
              title: t.title || "(No title)",
              url: t.url || "",
              favIconUrl: t.favIconUrl || "",
              active: !!t.active,
              audible: !!t.audible,
            };
            return existing ? { ...existing, ...base } : base;
          });
        [...space.pinned, ...Object.values(space.folders || {}).flat()].forEach((t) => {
          t.active = t.id === activeTabId;
        });
        state.spaces[state.currentSpace] = space;
        state.lastActiveByTabId = state.lastActiveByTabId || {};
        space.tabs.forEach((t) => {
          if (state.lastActiveByTabId[t.id] == null) state.lastActiveByTabId[t.id] = Date.now();
        });
        await saveState(state);
        return state;
      }

      case "saveState":
        await saveState(message.state);
        return { ok: true };

      case "closeTab": {
        const tabId = message.tabId;
        const state = await getState();
        const space = state.spaces[state.currentSpace];
        if (space) {
          const removeFrom = (list) => {
            const i = list.findIndex((t) => t.id === tabId);
            if (i !== -1) { list.splice(i, 1); return true; }
            return false;
          };
          removeFrom(space.pinned);
          removeFrom(space.tabs);
          Object.keys(space.folders || {}).forEach((fn) => removeFrom(space.folders[fn]));
          await saveState(state);
        }
        await browser.tabs.remove(tabId);
        broadcastRefresh();
        return { ok: true };
      }

      case "activateTab":
        await markTabActive(message.tabId);
        await browser.tabs.update(message.tabId, { active: true });
        return { ok: true };

      case "duplicateTab":
        try {
          const tab = await browser.tabs.get(message.tabId);
          await browser.tabs.create({ url: tab.url, active: false });
        } catch (_) {}
        broadcastRefresh();
        return { ok: true };

      case "updateTabUrl":
        await browser.tabs.update(message.tabId, { url: message.url });
        return { ok: true };

      case "moveTabToFolder": {
        const state = await getState();
        const space = state.spaces[state.currentSpace];
        if (!space) return null;
        const { tabId, folderName, fromFolder } = message;
        const all = [...space.pinned, ...space.tabs, ...Object.values(space.folders).flat()];
        const tab = all.find((t) => t.id === tabId);
        if (!tab) return null;
        const removeFrom = (list) => {
          const i = list.findIndex((t) => t.id === tabId);
          if (i !== -1) return list.splice(i, 1)[0];
          return null;
        };
        if (fromFolder && space.folders[fromFolder]) {
          removeFrom(space.folders[fromFolder]);
        } else {
          removeFrom(space.pinned) || removeFrom(space.tabs);
        }
        if (folderName) {
          if (!space.folders[folderName]) space.folders[folderName] = [];
          if (!space.folders[folderName].some((t) => t.id === tabId)) space.folders[folderName].push(tab);
        } else {
          space.tabs.push(tab);
        }
        await saveState(state);
        broadcastRefresh();
        return state;
      }

      case "addFolder": {
        const state = await getState();
        const space = state.spaces[state.currentSpace];
        if (!space) return null;
        const name = message.folderName || "New folder";
        if (!space.folders[name]) space.folders[name] = [];
        await saveState(state);
        return state;
      }

      case "renameFolder": {
        const state = await getState();
        const space = state.spaces[state.currentSpace];
        if (!space || !space.folders[message.oldName]) return null;
        const tabs = space.folders[message.oldName];
        delete space.folders[message.oldName];
        space.folders[message.newName] = tabs;
        await saveState(state);
        return state;
      }

      case "removeFolder": {
        const state = await getState();
        const space = state.spaces[state.currentSpace];
        if (!space) return null;
        const tabs = space.folders[message.folderName] || [];
        delete space.folders[message.folderName];
        space.tabs = [...space.tabs, ...tabs];
        await saveState(state);
        broadcastRefresh();
        return state;
      }

      case "addToFavorites": {
        const state = await getState();
        const space = state.spaces[state.currentSpace];
        if (!space) return null;
        const { url, title, favIconUrl, tabId } = message;
        if (!url) return null;
        const exists = (space.favorites || []).some((f) => f.url === url);
        if (!exists) {
          space.favorites = space.favorites || [];
          space.favorites.push({ url, title: title || url, favIconUrl: favIconUrl || "" });
        }
        // Favorites and Pinned are mutually exclusive — always evict from pinned
        // by both tabId and URL, in case stale data caused the tab to land in both.
        if (Array.isArray(space.pinned)) {
          // Evict by tabId
          if (tabId != null) {
            const key = String(tabId);
            const i = space.pinned.findIndex((t) => t && String(t.id) === key);
            if (i !== -1) {
              const [pinnedTab] = space.pinned.splice(i, 1);
              space.tabs = space.tabs || [];
              if (!space.tabs.some((t) => t && String(t.id) === key)) {
                space.tabs.push(pinnedTab);
              }
            }
          }
          // Also evict any pinned tab that has the same URL (covers stale-data cases)
          if (url) {
            const urlKey = url;
            let idx;
            while ((idx = space.pinned.findIndex((t) => t && t.url === urlKey)) !== -1) {
              const [pinnedTab] = space.pinned.splice(idx, 1);
              space.tabs = space.tabs || [];
              const idKey = pinnedTab && String(pinnedTab.id);
              if (idKey && !space.tabs.some((t) => t && String(t.id) === idKey)) {
                space.tabs.push(pinnedTab);
              }
            }
          }
        }
        await saveState(state);
        return state;
      }

      case "removeFavorite": {
        const state = await getState();
        const space = state.spaces[state.currentSpace];
        if (!space) return null;
        space.favorites = (space.favorites || []).filter((f) => f.url !== message.url);
        await saveState(state);
        return state;
      }

      case "openFavorite": {
        const tabs = await getTabs();
        const existing = tabs.find((t) => t.url === message.url);
        if (existing) await browser.tabs.update(existing.id, { active: true });
        else await browser.tabs.create({ url: message.url, active: message.active !== false });
        return { ok: true };
      }

      case "createTab": {
        await browser.tabs.create({ url: message.url || "about:blank", active: message.active !== false });
        broadcastRefresh();
        return { ok: true };
      }

      case "updateSpaceIcon": {
        const state = await getState();
        const space = state.spaces[message.spaceName];
        if (!space) return null;
        space.icon = message.icon || "◇";
        await saveState(state);
        return state;
      }

      case "updateSpaceTheme": {
        const state = await getState();
        const space = state.spaces[message.spaceName];
        if (!space) return null;
        space.theme = message.theme || "default";
        await saveState(state);
        return state;
      }

      case "updateSpaceColor": {
        const state = await getState();
        const space = state.spaces[message.spaceName];
        if (!space) return null;
        space.color = message.color || null;
        await saveState(state);
        return state;
      }

      case "updateSpaceGradient": {
        const state = await getState();
        const space = state.spaces[message.spaceName];
        if (!space) return null;
        space.gradient = message.gradient || null;
        await saveState(state);
        return state;
      }

      case "updateSpaceLayout": {
        const state = await getState();
        const space = state.spaces[message.spaceName];
        if (!space) return null;
        space.layout = message.layout || "list";
        await saveState(state);
        return state;
      }

      case "renameSpace": {
        const state = await getState();
        if (!state.spaces[message.oldName] || state.spaces[message.newName]) return null;
        state.spaces[message.newName] = state.spaces[message.oldName];
        delete state.spaces[message.oldName];
        if (state.currentSpace === message.oldName) state.currentSpace = message.newName;
        await saveState(state);
        return state;
      }

      case "removeSpace": {
        const state = await getState();
        const names = Object.keys(state.spaces);
        if (names.length <= 1) return null;
        delete state.spaces[message.spaceName];
        if (state.currentSpace === message.spaceName) {
          state.currentSpace = names.find((n) => n !== message.spaceName) || names[0];
        }
        await saveState(state);
        return state;
      }

      default:
        return null;
    }
  };
  run().then(sendResponse);
  return true;
});

if (ctx.contextMenus) {
  ctx.contextMenus.onClicked.addListener(async (info, tab) => {
    const c = rightClickContext;
    rightClickContext = null;
    if (!c || !tab) return;
    const refresh = () => tab && tab.id && browser.tabs.sendMessage(tab.id, { action: "refreshTabs" }).catch(() => {});

    if (info.menuItemId === "arcify-copy" && c.url) {
      await browser.tabs.sendMessage(tab.id, { action: "copyToClipboard", text: c.url }).catch(() => {});
    } else if (info.menuItemId === "arcify-duplicate" && c.tabId) {
      const t = await browser.tabs.get(c.tabId).catch(() => null);
      if (t) await browser.tabs.create({ url: t.url, active: false });
      refresh();
    } else if (info.menuItemId === "arcify-pin" && c.type === "tab") {
      await browser.tabs.sendMessage(tab.id, { action: "contextMenuAction", cmd: "pin", context: c });
      refresh();
    } else if (info.menuItemId === "arcify-fav" && c.type === "tab") {
      await browser.tabs.sendMessage(tab.id, { action: "contextMenuAction", cmd: c.inFav ? "removeFav" : "addFav", context: c });
      refresh();
    } else if (info.menuItemId === "arcify-rename" && c.tabId) {
      await browser.tabs.sendMessage(tab.id, { action: "contextMenuAction", cmd: "renameTab", context: c });
      refresh();
    } else if (info.menuItemId === "arcify-editurl" && c.tabId) {
      await browser.tabs.sendMessage(tab.id, { action: "contextMenuAction", cmd: "editUrl", context: c });
      refresh();
    } else if (info.menuItemId === "arcify-remove-folder" && c.tabId && c.inFolder) {
      const state = await getState();
      const space = state.spaces[state.currentSpace];
      if (space && space.folders[c.inFolder]) {
        const i = space.folders[c.inFolder].findIndex((t) => t.id === c.tabId);
        if (i !== -1) {
          const [tab] = space.folders[c.inFolder].splice(i, 1);
          space.tabs = [...(space.tabs || []), tab];
          await saveState(state);
        }
      }
      refresh();
    } else if (String(info.menuItemId).startsWith(MOVE_PREFIX) && c.tabId) {
      const id = String(info.menuItemId);
      if (id === MOVE_PREFIX + "new") {
        await browser.tabs.sendMessage(tab.id, { action: "contextMenuAction", cmd: "moveToNewFolder", context: c });
      } else {
        const folderName = id.slice(MOVE_PREFIX.length).replace(/_/g, " ");
        const state = await getState();
        const space = state.spaces[state.currentSpace];
        if (space) {
          const all = [...(space.pinned || []), ...(space.tabs || []), ...Object.values(space.folders || {}).flat()];
          const tab = all.find((t) => t.id === c.tabId);
          if (tab) {
            const removeFrom = (list) => { const i = list.findIndex((t) => t.id === c.tabId); if (i !== -1) return list.splice(i, 1)[0]; return null; };
            if (c.inFolder && space.folders[c.inFolder]) removeFrom(space.folders[c.inFolder]);
            else removeFrom(space.pinned) || removeFrom(space.tabs);
            if (!space.folders[folderName]) space.folders[folderName] = [];
            space.folders[folderName].push(tab);
            await saveState(state);
          }
        }
      }
      refresh();
    } else if (info.menuItemId === "arcify-folder-rename" && c.type === "folder") {
      await browser.tabs.sendMessage(tab.id, { action: "contextMenuAction", cmd: "renameFolder", context: c });
      refresh();
    } else if (info.menuItemId === "arcify-folder-remove" && c.type === "folder") {
      const state = await getState();
      const space = state.spaces[state.currentSpace];
      if (space && space.folders[c.folderName]) {
        space.tabs = [...(space.tabs || []), ...space.folders[c.folderName]];
        delete space.folders[c.folderName];
        await saveState(state);
      }
      refresh();
    } else if (info.menuItemId === "arcify-space-edit" && c.type === "space") {
      await browser.tabs.sendMessage(tab.id, { action: "contextMenuAction", cmd: "editSpace", context: c });
      refresh();
    } else if (info.menuItemId === "arcify-space-remove" && c.type === "space" && c.spaceName) {
      const state = await getState();
      const names = Object.keys(state.spaces || {});
      if (names.length > 1) {
        delete state.spaces[c.spaceName];
        if (state.currentSpace === c.spaceName) state.currentSpace = names.find((n) => n !== c.spaceName) || names[0];
        await saveState(state);
      }
      refresh();
    } else if (info.menuItemId === "arcify-fav-remove" && c.type === "favorite" && c.url) {
      const state = await getState();
      const space = state.spaces[state.currentSpace];
      if (space) {
        space.favorites = (space.favorites || []).filter((f) => f.url !== c.url);
        await saveState(state);
      }
      refresh();
    }
  });
}
