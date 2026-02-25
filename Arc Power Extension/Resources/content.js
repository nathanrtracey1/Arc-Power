// content.js
// Arc-style sidebar: Favorites grid, Pinned, Folders, Tabs. Close buttons, live updates, swipe spaces.

if (typeof window.arcifyLoaded !== "undefined" && window.arcifyLoaded) {
} else {
  window.arcifyLoaded = true;

  const isIOS = /iPhone|iPad|iPod/.test((navigator && navigator.userAgent) || "");

  // On iOS we do not inject the sidebar panel into web pages.
  // The Safari toolbar popover (`popup.html`) is the only UI there.
  if (!isIOS) {

  const host = document.createElement("div");
  host.id = "arcify-host";
  host.style.cssText = "position:fixed;left:0;top:0;width:280px;height:100vh;z-index:999999";
  function updateHostPointerEvents() {
    const panelVisible = panel.classList.contains("arcify-panel-visible");
    const menuOpen = shadowRoot.querySelector(".arcify-context-menu");
    host.style.pointerEvents = (panelVisible || menuOpen) ? "auto" : "none";
  }
  document.body.appendChild(host);
  const shadowRoot = host.attachShadow({ mode: "open" });
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = (browser.runtime || chrome.runtime).getURL("ui.css");
  shadowRoot.appendChild(link);
  const panel = document.createElement("div");
  panel.id = "arcify-panel";
  panel.className = "arcify-panel";
  shadowRoot.appendChild(panel);

  function getArcifyRoot() { return shadowRoot; }
  function placeContextMenu(menu, clientX, clientY) {
    getArcifyRoot().appendChild(menu);
    menu.style.left = clientX + "px";
    menu.style.top = clientY + "px";
    requestAnimationFrame(() => {
      const r = menu.getBoundingClientRect();
      const pad = 8;
      let left = clientX;
      let top = clientY;
      if (left + r.width + pad > window.innerWidth) left = window.innerWidth - r.width - pad;
      if (top + r.height + pad > window.innerHeight) top = window.innerHeight - r.height - pad;
      if (left < pad) left = pad;
      if (top < pad) top = pad;
      menu.style.left = left + "px";
      menu.style.top = top + "px";
    });
  }

  function getContextFromTarget(target) {
    if (!target || !target.closest) return null;
    const spaceData = state.spaces[state.currentSpace];
    if (!spaceData) return null;
    const tabRow = target.closest(".arcify-tab");
    if (tabRow) {
      const tabId = parseInt(tabRow.dataset.id, 10);
      const pinned = tabRow.classList.contains("arcify-pinned");
      const folderHeader = tabRow.closest(".arcify-folder-tabs");
      const inFolder = folderHeader ? (tabRow.closest(".arcify-folder-section") && tabRow.closest(".arcify-folder-section").dataset.folder) : null;
      const tab = [...(spaceData.pinned || []), ...(spaceData.tabs || []), ...Object.values(spaceData.folders || {}).flat()].find((t) => t.id === tabId);
      const inFav = (spaceData.favorites || []).some((f) => f.url === (tab && tab.url));
      const folderNames = Object.keys(spaceData.folders || {});
      return { type: "tab", tabId, pinned, inFolder: inFolder || null, inFav, folderNames, url: tab && tab.url, title: tab && tab.title, tab };
    }
    const folderHeader = target.closest(".arcify-folder-header");
    if (folderHeader) {
      const section = folderHeader.closest(".arcify-folder-section");
      const folderName = section && section.dataset.folder;
      return folderName ? { type: "folder", folderName } : null;
    }
    const spaceBtn = target.closest(".arcify-space-emoji-btn:not(.arcify-space-emoji-new)");
    if (spaceBtn) {
      const spaceName = spaceBtn.title || state.currentSpace;
      const canRemove = Object.keys(state.spaces).length > 1;
      return { type: "space", spaceName, canRemove };
    }
    const favTile = target.closest(".arcify-favorite-tile");
    if (favTile && favTile.dataset.url) {
      return { type: "favorite", url: favTile.dataset.url };
    }
    return null;
  }

  shadowRoot.addEventListener("mousedown", (e) => {
    if (e.button !== 2) return;
    const ctx = getContextFromTarget(e.target);
    sendBackground("setRightClickContext", { context: ctx });
  }, true);
  document.addEventListener("mousedown", (e) => {
    if (e.button !== 2) return;
    if (e.target && e.target.id === "arcify-host") return;
    sendBackground("setRightClickContext", { context: null });
  });

  shadowRoot.addEventListener("contextmenu", (e) => {
    if (getContextFromTarget(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      showNativePanelContextMenu(e);
    }
  }, true);

  const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  host.setAttribute("data-system-theme", dark ? "dark" : "light");
  updateHostPointerEvents();

  const DEFAULT_SPACE = { pinned: [], folders: {}, tabs: [], favorites: [], icon: "◇", theme: "default", color: null, gradient: null };
  let state = {
    spaces: { Default: { ...DEFAULT_SPACE } },
    currentSpace: "Default",
    lastActiveByTabId: {}
  };
  let pendingSpaceAnimationDirection = null;
  let currentScrollArea = null;

  function sendBackground(action, payload = {}) {
    return browser.runtime.sendMessage({ action, ...payload });
  }

  const NATIVE_APP_NAMES = (() => {
    const fromManifest = (browser.runtime && typeof browser.runtime.getManifest === "function" && browser.runtime.getManifest() && browser.runtime.getManifest().name) ? browser.runtime.getManifest().name : null;
    const names = [fromManifest, "Arc Power"].filter(Boolean);
    return Array.from(new Set(names));
  })();

  async function sendNativeShowMenu(ctx) {
    let lastErr = null;
    for (const name of NATIVE_APP_NAMES) {
      try {
        return await browser.runtime.sendNativeMessage(name, { command: "show-menu", context: ctx });
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("sendNativeMessage failed");
  }

  async function showNativePanelContextMenu(e) {
    const ctx = getContextFromTarget(e.target);
    if (!ctx) return;
    if (!browser.runtime || typeof browser.runtime.sendNativeMessage !== "function") {
      showPanelContextMenu(e);
      return;
    }
    try {
      const resp = await sendNativeShowMenu(ctx);
      // Some platforms (notably iOS) may support the messaging bridge but not native menus.
      if (resp && resp.supportedNativeMenu === false) {
        showPanelContextMenu(e);
        return;
      }
      const selected = resp && resp.selected;
      if (!selected || selected === null) return;
      handleNativeMenuSelection(String(selected), ctx);
    } catch (_) {
      showPanelContextMenu(e);
    }
  }

  function handleNativeMenuSelection(selected, ctx) {
    if (!selected || !ctx) return;

    if (ctx.type === "tab") {
      const spaceData = state.spaces[state.currentSpace];
      if (!spaceData) return;

      if (selected === "copy-link" && ctx.url) {
        navigator.clipboard.writeText(ctx.url).catch(() => {});
        return;
      }

      if (selected === "duplicate" && ctx.tabId) {
        sendBackground("duplicateTab", { tabId: ctx.tabId }).then(() => loadState().then(() => renderPanel()));
        return;
      }

      if (selected === "pin" && ctx.tabId) {
        if (ctx.pinned) unpinTabInSpace(spaceData, ctx.tabId, ctx.tab);
        else pinTabInSpace(spaceData, ctx.tabId, ctx.tab);
        saveState().then(() => renderPanel());
        return;
      }

      if (selected === "toggle-fav") {
        if (ctx.inFav) {
          sendBackground("removeFavorite", { url: ctx.url }).then(() => loadState().then(() => renderPanel()));
        } else {
          sendBackground("addToFavorites", {
            url: ctx.url,
            title: ctx.title,
            favIconUrl: (ctx.tab && ctx.tab.favIconUrl) || "",
            tabId: ctx.tabId,
            pinned: ctx.pinned
          }).then(() => loadState().then(() => renderPanel()));
        }
        return;
      }

      if (selected === "rename-tab" && ctx.tabId) {
        const current = (ctx.tab && (ctx.tab.customTitle || ctx.tab.title)) || ctx.title || "";
        const next = prompt("Tab name?", current);
        if (next === null) return;
        setTabCustomTitle(spaceData, ctx.tabId, next);
        saveState().then(() => renderPanel());
        return;
      }

      if (selected === "edit-url" && ctx.tabId && ctx.tab) {
        const newUrl = prompt("Enter new URL", ctx.tab.url || "https://");
        if (newUrl) sendBackground("updateTabUrl", { tabId: ctx.tabId, url: newUrl }).then(() => loadState().then(() => loadTabs()));
        return;
      }

      if (selected === "remove-from-folder" && ctx.tabId && ctx.inFolder) {
        sendBackground("moveTabToFolder", { tabId: ctx.tabId, folderName: null, fromFolder: ctx.inFolder }).then(() => loadState().then(() => renderPanel()));
        return;
      }

      if (selected === "move-to-new-folder" && ctx.tabId) {
        const name = prompt("Folder name?", "New folder");
        if (name) {
          sendBackground("addFolder", { folderName: name })
            .then(() => sendBackground("moveTabToFolder", { tabId: ctx.tabId, folderName: name, fromFolder: ctx.inFolder || undefined }))
            .then(() => loadState().then(() => renderPanel()));
        }
        return;
      }

      const prefix = "move-to-folder-b64:";
      if (selected.startsWith(prefix) && ctx.tabId) {
        let folderName = null;
        try { folderName = atob(selected.slice(prefix.length)); } catch (_) {}
        if (folderName) {
          sendBackground("moveTabToFolder", { tabId: ctx.tabId, folderName, fromFolder: ctx.inFolder || undefined })
            .then(() => loadState().then(() => renderPanel()));
        }
        return;
      }
    }

    if (ctx.type === "folder" && ctx.folderName) {
      if (selected === "folder-rename") {
        const newName = prompt("Folder name?", ctx.folderName);
        if (newName && newName !== ctx.folderName) sendBackground("renameFolder", { oldName: ctx.folderName, newName }).then(() => loadState().then(() => renderPanel()));
        return;
      }
      if (selected === "folder-remove") {
        sendBackground("removeFolder", { folderName: ctx.folderName }).then(() => loadState().then(() => renderPanel()));
        return;
      }
    }

    if (ctx.type === "space" && ctx.spaceName) {
      if (selected === "space-edit") {
        showSpaceSetupModal(true, ctx.spaceName);
        return;
      }
      if (selected === "space-remove" && ctx.canRemove) {
        sendBackground("removeSpace", { spaceName: ctx.spaceName }).then(() => loadState().then(() => renderPanel()));
        return;
      }
    }

    if (ctx.type === "favorite" && ctx.url) {
      if (selected === "favorite-remove") {
        sendBackground("removeFavorite", { url: ctx.url }).then(() => loadState().then(() => renderPanel()));
      }
    }
  }

  function loadState() {
    return sendBackground("getState").then((s) => {
      if (s) state = s;
      return state;
    });
  }

  function loadTabs() {
    return sendBackground("loadTabs").then((s) => {
      if (s) state = s;
      renderPanel();
    });
  }

  function saveState() {
    return sendBackground("saveState", { state });
  }

  function faviconUrl(tabOrFav) {
    const url = tabOrFav.favIconUrl || tabOrFav.favIconUrl;
    if (url && typeof url === "string" && url.startsWith("http")) return url;
    try {
      const u = new URL(tabOrFav.url || "about:blank");
      return "https://www.google.com/s2/favicons?domain=" + u.hostname + "&sz=32";
    } catch (_) {
      return "";
    }
  }

  function simplifyUrl(url) {
    try {
      const u = new URL(url);
      return (u.hostname || "").replace(/^www\./, "");
    } catch (_) {
      return String(url || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    }
  }

  function switchSpace(direction) {
    const names = Object.keys(state.spaces);
    const i = names.indexOf(state.currentSpace);
    if (i === -1) return;
    const delta = direction === "next" ? 1 : -1;
    const targetIndex = i + delta;
    if (targetIndex < 0 || targetIndex >= names.length) return;
    const next = names[targetIndex];
    state.currentSpace = next;
    pendingSpaceAnimationDirection = direction;
    saveState().then(() => renderPanel());
  }

  function removeAllById(list, tabId) {
    if (!Array.isArray(list)) return { kept: [], removed: [] };
    const key = String(tabId);
    const kept = [];
    const removed = [];
    for (const t of list) {
      if (t && String(t.id) === key) removed.push(t);
      else kept.push(t);
    }
    return { kept, removed };
  }

  function unpinTabInSpace(spaceData, tabId, fallbackTab) {
    if (!spaceData || tabId == null) return;
    const key = String(tabId);
    spaceData.tabs = spaceData.tabs || [];
    spaceData.pinned = spaceData.pinned || [];

    const { kept, removed } = removeAllById(spaceData.pinned, tabId);
    spaceData.pinned = kept;

    // Ensure the tab exists in only one place after unpin.
    spaceData.tabs = (spaceData.tabs || []).filter((t) => t && String(t.id) !== key);
    Object.keys(spaceData.folders || {}).forEach((fn) => {
      spaceData.folders[fn] = (spaceData.folders[fn] || []).filter((t) => t && String(t.id) !== key);
    });

    const tabToKeep = removed[0] || fallbackTab;
    if (tabToKeep) spaceData.tabs.push(tabToKeep);
  }

  function pinTabInSpace(spaceData, tabId, tab) {
    if (!spaceData || tabId == null || !tab) return;
    const key = String(tabId);
    spaceData.tabs = spaceData.tabs || [];
    spaceData.pinned = spaceData.pinned || [];

    // Ensure the tab exists in only one place after pin.
    spaceData.tabs = (spaceData.tabs || []).filter((t) => t && String(t.id) !== key);
    Object.keys(spaceData.folders || {}).forEach((fn) => {
      spaceData.folders[fn] = (spaceData.folders[fn] || []).filter((t) => t && String(t.id) !== key);
    });
    spaceData.pinned = (spaceData.pinned || []).filter((t) => t && String(t.id) !== key);
    spaceData.pinned.push(tab);
  }

  function setTabCustomTitle(spaceData, tabId, customTitle) {
    if (!spaceData || tabId == null) return;
    const key = String(tabId);
    const next = customTitle && String(customTitle).trim() ? String(customTitle).trim() : null;
    const apply = (t) => {
      if (!t || String(t.id) !== key) return;
      if (next) t.customTitle = next;
      else delete t.customTitle;
    };
    (spaceData.pinned || []).forEach(apply);
    (spaceData.tabs || []).forEach(apply);
    Object.values(spaceData.folders || {}).flat().forEach(apply);
  }

  function findTabById(spaceData, tabId) {
    if (!spaceData || tabId == null) return null;
    const key = String(tabId);
    return (
      (spaceData.pinned || []).find((t) => t && String(t.id) === key) ||
      (spaceData.tabs || []).find((t) => t && String(t.id) === key) ||
      Object.values(spaceData.folders || {}).flat().find((t) => t && String(t.id) === key) ||
      null
    );
  }

  function removeTabFromAllLists(spaceData, tabId) {
    if (!spaceData || tabId == null) return null;
    const key = String(tabId);
    let found = null;
    const removeFrom = (list) => {
      if (!Array.isArray(list)) return;
      for (let i = list.length - 1; i >= 0; i--) {
        const t = list[i];
        if (t && String(t.id) === key) {
          if (!found) found = t;
          list.splice(i, 1);
        }
      }
    };
    removeFrom(spaceData.pinned);
    removeFrom(spaceData.tabs);
    Object.keys(spaceData.folders || {}).forEach((fn) => removeFrom(spaceData.folders[fn]));
    return found;
  }

  function addFavoriteAtIndex(spaceData, fav, index) {
    if (!spaceData || !fav || !fav.url) return;
    spaceData.favorites = spaceData.favorites || [];
    const existingIndex = (spaceData.favorites || []).findIndex((f) => f && f.url === fav.url);
    const existing = existingIndex !== -1 ? spaceData.favorites[existingIndex] : null;
    if (existingIndex !== -1) spaceData.favorites.splice(existingIndex, 1);

    const item = existing || {
      url: fav.url,
      title: fav.title || fav.url,
      favIconUrl: fav.favIconUrl || ""
    };

    let i = typeof index === "number" ? index : spaceData.favorites.length;
    if (i < 0) i = 0;
    if (i > spaceData.favorites.length) i = spaceData.favorites.length;
    spaceData.favorites.splice(i, 0, item);
  }

  function moveTabByDrag(spaceData, tabId, targetSection, targetFolder, targetBeforeTabId) {
    if (!spaceData || tabId == null) return;
    const tab = removeTabFromAllLists(spaceData, tabId) || findTabById(spaceData, tabId);
    if (!tab) return;

    let targetList = null;
    if (targetSection === "pinned") targetList = (spaceData.pinned = spaceData.pinned || []);
    else if (targetSection === "tabs") targetList = (spaceData.tabs = spaceData.tabs || []);
    else if (targetSection === "folder" && targetFolder) {
      spaceData.folders = spaceData.folders || {};
      targetList = (spaceData.folders[targetFolder] = spaceData.folders[targetFolder] || []);
    } else return;

    let toIndex = targetList.length;
    if (targetBeforeTabId != null) {
      const key = String(targetBeforeTabId);
      const idx = targetList.findIndex((t) => t && String(t.id) === key);
      if (idx !== -1) toIndex = idx;
    }
    targetList.splice(toIndex, 0, tab);
  }

  function createTabRow(tab, options) {
    const { pinned = false, inFolder = null, showClose = true } = options || {};
    const isActive = !!tab.active;
    const row = document.createElement("div");
    row.className = "arcify-tab" + (pinned ? " arcify-pinned" : "") + (isActive ? " arcify-tab-active" : "");
    row.dataset.id = String(tab.id);
    row.dataset.title = (tab.customTitle || tab.title || "").toLowerCase();

    const favicon = document.createElement("span");
    favicon.className = "arcify-favicon";
    const img = document.createElement("img");
    img.src = faviconUrl(tab);
    img.alt = "";
    img.onerror = () => { favicon.classList.add("arcify-favicon-missing"); };
    favicon.appendChild(img);

    const label = document.createElement("span");
    label.className = "arcify-tab-label";
    label.textContent = tab.customTitle || tab.title || "(No title)";

    row.appendChild(favicon);
    row.appendChild(label);

    if (pinned && tab.id) {
      const unpinBtn = document.createElement("button");
      unpinBtn.className = "arcify-tab-unpin";
      unpinBtn.type = "button";
      unpinBtn.setAttribute("aria-label", "Remove from pinned");
      unpinBtn.textContent = "Unpin";
      unpinBtn.onclick = (e) => {
        e.stopPropagation();
        const spaceData = state.spaces[state.currentSpace];
        unpinTabInSpace(spaceData, tab.id, tab);
        saveState().then(() => renderPanel());
      };
      row.appendChild(unpinBtn);
    }
    if (showClose && tab.id) {
      const closeBtn = document.createElement("button");
      closeBtn.className = "arcify-tab-close";
      closeBtn.type = "button";
      closeBtn.setAttribute("aria-label", "Close tab");
      closeBtn.innerHTML = "×";
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        sendBackground("closeTab", { tabId: tab.id });
      };
      row.appendChild(closeBtn);
    }

    row.onclick = (e) => {
      if (e.target.closest(".arcify-context-menu") || e.target.closest(".arcify-tab-close") || e.target.closest(".arcify-tab-unpin")) return;
      sendBackground("activateTab", { tabId: tab.id });
    };

    row.draggable = true;
    row.setAttribute("draggable", "true");
    row.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", String(tab.id));
      // Safari is pickier about supported types; set "text" too.
      e.dataTransfer.setData("text", String(tab.id));
      const fromSection = pinned ? "pinned" : (inFolder ? "folder" : "tabs");
      e.dataTransfer.setData("application/json", JSON.stringify({ dragType: "tab", tabId: tab.id, fromSection, fromFolder: inFolder || null }));
      e.dataTransfer.effectAllowed = "move";
      row.classList.add("arcify-dragging");
    });
    row.addEventListener("dragend", () => row.classList.remove("arcify-dragging"));
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!e.dataTransfer.types.includes("text/plain")) return;
      row.classList.add("arcify-drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("arcify-drag-over"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove("arcify-drag-over");
      const spaceData = state.spaces[state.currentSpace];
      let payload = {};
      try { payload = JSON.parse(e.dataTransfer.getData("application/json") || "{}"); } catch (_) {}
      if (payload && payload.dragType && payload.dragType !== "tab") return;
      const draggedId = payload.tabId != null ? payload.tabId : parseInt(e.dataTransfer.getData("text/plain") || e.dataTransfer.getData("text"), 10);
      if (!draggedId) return;
      const targetSection = pinned ? "pinned" : (inFolder ? "folder" : "tabs");
      const targetFolder = inFolder || null;
      moveTabByDrag(spaceData, draggedId, targetSection, targetFolder, tab.id);
      saveState().then(() => renderPanel());
    });

    return row;
  }

  const FOLDER_ICON = "📁";
  function createFolderSection(folderName, tabs, spaceData) {
    const section = document.createElement("div");
    section.className = "arcify-folder-section";
    section.dataset.folder = folderName;

    const header = document.createElement("div");
    header.className = "arcify-folder-header";
    header.draggable = false;
    const folderIcon = document.createElement("span");
    folderIcon.className = "arcify-folder-icon";
    folderIcon.textContent = FOLDER_ICON;
    const chevron = document.createElement("span");
    chevron.className = "arcify-chevron";
    chevron.textContent = "›";
    const label = document.createElement("span");
    label.className = "arcify-folder-label";
    label.textContent = folderName;
    header.appendChild(folderIcon);
    header.appendChild(chevron);
    header.appendChild(label);

    const list = document.createElement("div");
    list.className = "arcify-folder-tabs";
    let expanded = true;
    function toggle() {
      expanded = !expanded;
      list.style.display = expanded ? "block" : "none";
      chevron.style.transform = expanded ? "rotate(90deg)" : "rotate(0deg)";
    }
    header.onclick = (e) => {
      if (!e.target.closest(".arcify-folder-rename")) toggle();
    };

    header.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      header.classList.add("arcify-drag-over");
    });
    header.addEventListener("dragleave", () => header.classList.remove("arcify-drag-over"));
    header.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      header.classList.remove("arcify-drag-over");
      let fromFolder = null;
      try {
        const d = JSON.parse(e.dataTransfer.getData("application/json") || "{}");
        fromFolder = d.fromFolder || null;
      } catch (_) {}
      const tabId = parseInt(e.dataTransfer.getData("text/plain"), 10);
      sendBackground("moveTabToFolder", { tabId, folderName, fromFolder }).then(() =>
        loadState().then(() => renderPanel())
      );
    });

    tabs.forEach((tab) => {
      list.appendChild(createTabRow(tab, { pinned: false, inFolder: folderName }));
    });

    section.appendChild(header);
    section.appendChild(list);
    return section;
  }

  const SPACE_THEMES = ["default", "blue", "green", "purple", "orange"];
  const SPACE_EMOJIS = ["◇", "◆", "●", "★", "▲", "▸", "○", "◎", "🖥", "📁", "🔖", "📌", "⭐", "🔥", "💼", "🎯", "🚀", "💡", "🌈", "🎨", "📎", "✏️", "📂", "🏠", "❤️", "✨"];
  const COLOR_PRESETS = [
    { name: "Default", value: null },
    { name: "Blue", value: "#0A84FF" },
    { name: "Green", value: "#30D158" },
    { name: "Purple", value: "#BF5AF2" },
    { name: "Orange", value: "#FF9F0A" },
    { name: "Red", value: "#FF453A" },
    { name: "Pink", value: "#FF375F" },
    { name: "Teal", value: "#64D2FF" }
  ];

  function hexToRgba(hex, alpha) {
    const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    if (!m) return null;
    const r = parseInt(m[1], 16);
    const g = parseInt(m[2], 16);
    const b = parseInt(m[3], 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function updatePanelSystemTheme() {
    const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = dark ? "dark" : "light";
    panel.setAttribute("data-system-theme", theme);
    host.setAttribute("data-system-theme", theme);
  }

  function showSpaceSetupModal(editMode, existingName) {
    const existing = editMode && state.spaces[existingName];
    const overlay = document.createElement("div");
    overlay.className = "arcify-modal-overlay";
    const modal = document.createElement("div");
    modal.className = "arcify-modal";
    modal.innerHTML = "";

    const titleRow = document.createElement("div");
    titleRow.className = "arcify-modal-title-row";
    const title = document.createElement("div");
    title.className = "arcify-modal-title";
    title.textContent = editMode ? "Edit Space" : "New Space";
    titleRow.appendChild(title);
    const closeX = document.createElement("button");
    closeX.type = "button";
    closeX.className = "arcify-modal-close";
    closeX.setAttribute("aria-label", "Close");
    closeX.innerHTML = "×";
    closeX.onclick = () => overlay.remove();
    titleRow.appendChild(closeX);
    modal.appendChild(titleRow);

    const nameLabel = document.createElement("label");
    nameLabel.className = "arcify-modal-label";
    nameLabel.textContent = "Name";
    modal.appendChild(nameLabel);
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "arcify-modal-input";
    nameInput.placeholder = "Space name";
    nameInput.value = existing ? existingName : "";
    if (existingName) nameInput.dataset.oldName = existingName;
    modal.appendChild(nameInput);

    const iconLabel = document.createElement("label");
    iconLabel.className = "arcify-modal-label";
    iconLabel.textContent = "Icon (emoji)";
    modal.appendChild(iconLabel);
    const iconGrid = document.createElement("div");
    iconGrid.className = "arcify-emoji-grid";
    const selectedIcon = existing ? (existing.icon || "◇") : "◇";
    const iconInGrid = SPACE_EMOJIS.includes(selectedIcon);
    const customEmojiInput = document.createElement("input");
    customEmojiInput.type = "text";
    customEmojiInput.className = "arcify-modal-input arcify-modal-input-sm";
    customEmojiInput.placeholder = "Or paste any emoji";
    customEmojiInput.value = existing && selectedIcon && !iconInGrid ? selectedIcon : "";
    customEmojiInput.oninput = () => {
      if (customEmojiInput.value.trim()) {
        iconGrid.querySelectorAll(".arcify-emoji-btn").forEach((b) => b.classList.remove("arcify-emoji-selected"));
      }
    };
    SPACE_EMOJIS.forEach((emoji) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "arcify-emoji-btn" + (iconInGrid && emoji === selectedIcon ? " arcify-emoji-selected" : "");
      btn.textContent = emoji;
      btn.onclick = () => {
        iconGrid.querySelectorAll(".arcify-emoji-btn").forEach((b) => b.classList.remove("arcify-emoji-selected"));
        btn.classList.add("arcify-emoji-selected");
        customEmojiInput.value = "";
      };
      iconGrid.appendChild(btn);
    });
    modal.appendChild(iconGrid);
    const customEmojiLabel = document.createElement("label");
    customEmojiLabel.className = "arcify-modal-label arcify-modal-label-sm";
    customEmojiLabel.textContent = "Or any emoji:";
    modal.appendChild(customEmojiLabel);
    modal.appendChild(customEmojiInput);

    const colorLabel = document.createElement("label");
    colorLabel.className = "arcify-modal-label";
    colorLabel.textContent = "Accent color";
    modal.appendChild(colorLabel);
    const colorRow = document.createElement("div");
    colorRow.className = "arcify-color-row";
    COLOR_PRESETS.forEach((preset) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "arcify-color-btn";
      btn.title = preset.name;
      btn.dataset.color = preset.value || "";
      if (preset.value) btn.style.background = preset.value;
      else btn.classList.add("arcify-color-default");
      const isSelected = existing
        ? (existing.color === preset.value || (!existing.color && !preset.value))
        : !preset.value;
      if (isSelected) btn.classList.add("arcify-color-selected");
      btn.onclick = () => {
        colorRow.querySelectorAll(".arcify-color-btn").forEach((b) => b.classList.remove("arcify-color-selected"));
        btn.classList.add("arcify-color-selected");
        customColorInput.value = preset.value || "";
      };
      colorRow.appendChild(btn);
    });
    modal.appendChild(colorRow);
    const customLabel = document.createElement("label");
    customLabel.className = "arcify-modal-label arcify-modal-label-sm";
    customLabel.textContent = "Custom (hex, e.g. #FF5733)";
    modal.appendChild(customLabel);
    const customColorInput = document.createElement("input");
    customColorInput.type = "text";
    customColorInput.className = "arcify-modal-input arcify-modal-input-sm";
    customColorInput.placeholder = "#000000";
    customColorInput.value = existing && existing.color && !COLOR_PRESETS.some((p) => p.value === existing.color) ? existing.color : "";
    customColorInput.oninput = () => {
      const v = customColorInput.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) {
        colorRow.querySelectorAll(".arcify-color-btn").forEach((b) => b.classList.remove("arcify-color-selected"));
      }
    };
    modal.appendChild(customColorInput);

    const gradientLabel = document.createElement("label");
    gradientLabel.className = "arcify-modal-label arcify-modal-label-sm";
    gradientLabel.style.marginTop = "14px";
    const gradientCheck = document.createElement("input");
    gradientCheck.type = "checkbox";
    gradientCheck.checked = !!(existing && existing.gradient && existing.gradient.from && existing.gradient.to);
    gradientCheck.className = "arcify-modal-checkbox";
    gradientLabel.appendChild(gradientCheck);
    gradientLabel.appendChild(document.createTextNode(" Use gradient"));
    modal.appendChild(gradientLabel);
    let fromInput, toInput;
    const gradientRow = document.createElement("div");
    gradientRow.className = "arcify-gradient-row";
    const fromWrap = document.createElement("div");
    fromWrap.className = "arcify-gradient-field";
    const fromLabel = document.createElement("label");
    fromLabel.className = "arcify-modal-label arcify-modal-label-sm";
    fromLabel.textContent = "From";
    fromInput = document.createElement("input");
    fromInput.type = "text";
    fromInput.className = "arcify-modal-input arcify-modal-input-sm";
    fromInput.placeholder = "#0A84FF";
    fromInput.value = (existing && existing.gradient && existing.gradient.from) ? existing.gradient.from : "";
    fromWrap.appendChild(fromLabel);
    fromWrap.appendChild(fromInput);
    gradientRow.appendChild(fromWrap);
    const toWrap = document.createElement("div");
    toWrap.className = "arcify-gradient-field";
    const toLabel = document.createElement("label");
    toLabel.className = "arcify-modal-label arcify-modal-label-sm";
    toLabel.textContent = "To";
    toInput = document.createElement("input");
    toInput.type = "text";
    toInput.className = "arcify-modal-input arcify-modal-input-sm";
    toInput.placeholder = "#BF5AF2";
    toInput.value = (existing && existing.gradient && existing.gradient.to) ? existing.gradient.to : "";
    toWrap.appendChild(toLabel);
    toWrap.appendChild(toInput);
    gradientRow.appendChild(toWrap);
    modal.appendChild(gradientRow);

    const actions = document.createElement("div");
    actions.className = "arcify-modal-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "arcify-btn arcify-btn-ghost";
    cancelBtn.textContent = "Cancel";
    cancelBtn.onclick = () => { overlay.remove(); };
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "arcify-btn arcify-btn-primary";
    saveBtn.textContent = editMode ? "Save" : "Create";
    saveBtn.onclick = () => {
      const name = nameInput.value.trim();
      if (!name) return;
      const customIcon = customEmojiInput.value.trim();
      const firstEmoji = customIcon ? [...customIcon][0] : null;
      const iconBtn = iconGrid.querySelector(".arcify-emoji-selected");
      const icon = firstEmoji || (iconBtn ? iconBtn.textContent : null) || "◇";
      let color = null;
      const customHex = customColorInput.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(customHex)) {
        color = customHex;
      } else {
        const selectedColorBtn = colorRow.querySelector(".arcify-color-selected");
        if (selectedColorBtn && selectedColorBtn.dataset.color) {
          color = selectedColorBtn.dataset.color || null;
        }
      }
      let gradient = null;
      if (gradientCheck.checked) {
        const fromHex = fromInput.value.trim();
        const toHex = toInput.value.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(fromHex) && /^#[0-9a-fA-F]{6}$/.test(toHex)) {
          gradient = { from: fromHex, to: toHex };
        }
      }

      const done = () => { overlay.remove(); loadState().then(() => renderPanel()); };

      if (editMode) {
        const oldName = nameInput.dataset.oldName || existingName;
        (name !== oldName && !state.spaces[name]
          ? sendBackground("renameSpace", { oldName, newName: name }).then(() => loadState())
          : Promise.resolve()
        ).then(() =>
          sendBackground("updateSpaceIcon", { spaceName: name, icon }).then(() =>
            sendBackground("updateSpaceColor", { spaceName: name, color }).then(() =>
              sendBackground("updateSpaceGradient", { spaceName: name, gradient }).then(done)
            )
          )
        );
      } else {
        if (state.spaces[name]) return;
        state.spaces[name] = { ...DEFAULT_SPACE, icon, theme: "default", color, gradient };
        state.currentSpace = name;
        saveState().then(done);
      }
    };
    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    modal.appendChild(actions);

    overlay.appendChild(modal);
    modal.onclick = (e) => e.stopPropagation();
    let overlayCanClose = false;
    setTimeout(() => { overlayCanClose = true; }, 600);
    overlay.onclick = (e) => {
      if (e.target !== overlay || !overlayCanClose) return;
      overlay.remove();
    };
    panel.appendChild(overlay);
    requestAnimationFrame(() => nameInput.focus());
  }

  function showPanelContextMenu(e) {
    const ctx = getContextFromTarget(e.target);
    if (!ctx) return;
    e.preventDefault();
    e.stopPropagation();
    const menu = document.createElement("div");
    menu.className = "arcify-context-menu";
    const closeMenu = () => {
      if (menu.parentNode) menu.parentNode.removeChild(menu);
      document.removeEventListener("click", closeMenu);
      updateHostPointerEvents();
    };
    const addItem = (text, fn) => {
      const item = document.createElement("div");
      item.className = "arcify-menu-item";
      item.textContent = text;
      item.onmousedown = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        fn();
        closeMenu();
      };
      menu.appendChild(item);
    };

    if (ctx.type === "tab") {
      const spaceData = state.spaces[state.currentSpace];
      addItem("Copy Link", () => { if (ctx.url) navigator.clipboard.writeText(ctx.url).catch(() => {}); });
      addItem("Duplicate", () => sendBackground("duplicateTab", { tabId: ctx.tabId }).then(() => loadState().then(() => renderPanel())));
      addItem(ctx.pinned ? "Remove Pin" : "Pin", () => {
        if (ctx.pinned) unpinTabInSpace(spaceData, ctx.tabId, ctx.tab);
        else pinTabInSpace(spaceData, ctx.tabId, ctx.tab);
        saveState().then(() => renderPanel());
      });
      addItem(ctx.inFav ? "Remove from Favorites" : "Add to Favorites", () => {
        if (ctx.inFav) sendBackground("removeFavorite", { url: ctx.url }).then(() => loadState().then(() => renderPanel()));
        else sendBackground("addToFavorites", { url: ctx.url, title: ctx.title, favIconUrl: (ctx.tab && ctx.tab.favIconUrl) || "", tabId: ctx.tabId, pinned: ctx.pinned }).then(() => loadState().then(() => renderPanel()));
      });
      addItem("Rename Tab", () => {
        const current = (ctx.tab && (ctx.tab.customTitle || ctx.tab.title)) || ctx.title || "";
        const next = prompt("Tab name?", current);
        if (next === null) return;
        setTabCustomTitle(spaceData, ctx.tabId, next);
        saveState().then(() => renderPanel());
      });
      addItem("Edit URL", () => {
        const newUrl = prompt("Enter new URL", (ctx.tab && ctx.tab.url) || "https://");
        if (newUrl) sendBackground("updateTabUrl", { tabId: ctx.tabId, url: newUrl }).then(() => loadState().then(() => loadTabs()));
      });
      const folderNames = ctx.folderNames || Object.keys(spaceData.folders || {});
      if (folderNames.length > 0 || !ctx.inFolder) {
        const sub = document.createElement("div");
        sub.className = "arcify-menu-item arcify-submenu-label";
        sub.textContent = "Move to";
        menu.appendChild(sub);
        folderNames.forEach((fn) => {
          if (fn === ctx.inFolder) return;
          const item = document.createElement("div");
          item.className = "arcify-menu-item arcify-submenu-item";
          item.textContent = fn;
          item.onmousedown = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            sendBackground("moveTabToFolder", { tabId: ctx.tabId, folderName: fn, fromFolder: ctx.inFolder || undefined }).then(() => loadState().then(() => renderPanel()));
            closeMenu();
          };
          menu.appendChild(item);
        });
        const newFolderItem = document.createElement("div");
        newFolderItem.className = "arcify-menu-item arcify-submenu-item";
        newFolderItem.textContent = "+ New folder…";
        newFolderItem.onmousedown = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const name = prompt("Folder name?", "New folder");
          if (name) sendBackground("addFolder", { folderName: name }).then(() => sendBackground("moveTabToFolder", { tabId: ctx.tabId, folderName: name, fromFolder: ctx.inFolder || undefined })).then(() => loadState().then(() => renderPanel()));
          closeMenu();
        };
        menu.appendChild(newFolderItem);
      }
      if (ctx.inFolder) {
        addItem("Remove from folder", () => sendBackground("moveTabToFolder", { tabId: ctx.tabId, folderName: null, fromFolder: ctx.inFolder }).then(() => loadState().then(() => renderPanel())));
      }
    } else if (ctx.type === "folder") {
      addItem("Rename folder", () => {
        const newName = prompt("Folder name?", ctx.folderName);
        if (newName && newName !== ctx.folderName) sendBackground("renameFolder", { oldName: ctx.folderName, newName }).then(() => loadState().then(() => renderPanel()));
      });
      addItem("Remove folder", () => sendBackground("removeFolder", { folderName: ctx.folderName }).then(() => loadState().then(() => renderPanel())));
    } else if (ctx.type === "space") {
      addItem("Edit space", () => showSpaceSetupModal(true, ctx.spaceName));
      if (ctx.canRemove) addItem("Remove space", () => sendBackground("removeSpace", { spaceName: ctx.spaceName }).then(() => loadState().then(() => renderPanel())));
      addItem("Export data…", () => {
        sendBackground("getState").then((s) => {
          if (!s) return;
          const json = JSON.stringify(s);
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(json).catch(() => {
              prompt("Copy this JSON:", json);
            });
          } else {
            prompt("Copy this JSON:", json);
          }
        });
      });
      addItem("Import data…", () => {
        const text = prompt("Paste exported JSON");
        if (!text) return;
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch (e) {
          alert("That didn’t look like valid JSON.");
          return;
        }
        if (!parsed || typeof parsed !== "object" || !parsed.spaces) {
          alert("That JSON doesn’t look like Arc Power data.");
          return;
        }
        sendBackground("saveState", { state: parsed }).then(() => loadState().then(() => renderPanel()));
      });
    } else if (ctx.type === "favorite") {
      addItem("Remove from Favorites", () => sendBackground("removeFavorite", { url: ctx.url }).then(() => loadState().then(() => renderPanel())));
    }

    if (menu.children.length === 0) return;
    placeContextMenu(menu, e.clientX, e.clientY);
    updateHostPointerEvents();
    setTimeout(() => document.addEventListener("click", closeMenu), 0);
  }

  function renderPanel() {
    updatePanelSystemTheme();
    if (!state.spaces[state.currentSpace]) {
      state.spaces[state.currentSpace] = { ...DEFAULT_SPACE, icon: "◇", theme: "default", color: null };
    }
    const spaceData = state.spaces[state.currentSpace];
    if (!spaceData.icon) spaceData.icon = "◇";
    if (!spaceData.theme) spaceData.theme = "default";
    if (!spaceData.gradient) spaceData.gradient = null;

    panel.setAttribute("data-space-theme", spaceData.theme);
    if (spaceData.gradient && spaceData.gradient.from && spaceData.gradient.to) {
      panel.style.setProperty("--arcify-gradient", "linear-gradient(135deg, " + spaceData.gradient.from + " 0%, " + spaceData.gradient.to + " 100%)");
      panel.dataset.spaceGradient = "true";
      panel.style.removeProperty("--arcify-tint");
      if (spaceData.color) panel.style.setProperty("--arcify-accent", hexToRgba(spaceData.color, 0.68));
      else panel.style.removeProperty("--arcify-accent");
    } else {
      panel.removeAttribute("data-space-gradient");
      panel.style.removeProperty("--arcify-gradient");
      if (spaceData.color) {
        panel.style.setProperty("--arcify-accent", hexToRgba(spaceData.color, 0.68));
        panel.style.setProperty("--arcify-tint", hexToRgba(spaceData.color, 0.28));
      } else {
        panel.style.removeProperty("--arcify-accent");
        panel.style.removeProperty("--arcify-tint");
      }
    }
    const existingOverlay = panel.querySelector(".arcify-modal-overlay");
    panel.innerHTML = "";

    const scrollArea = document.createElement("div");
    scrollArea.className = "arcify-scroll";
    currentScrollArea = scrollArea;

    // Current URL box – shows simplified domain; click opens command bar
    const allTabs = [
      ...(spaceData.pinned || []),
      ...(spaceData.tabs || []),
      ...Object.values(spaceData.folders || {}).flat()
    ];
    const activeTab = allTabs.find((t) => t.active) || allTabs[0] || null;
    if (activeTab && activeTab.url) {
      const urlBox = document.createElement("button");
      urlBox.type = "button";
      urlBox.className = "arcify-new-tab-btn arcify-url-box";
      const simpleUrl = simplifyUrl(activeTab.url);
      urlBox.textContent = simpleUrl || activeTab.url;
      urlBox.onclick = () => {
        // Ask the command bar to open in the active tab with current URL.
        browser.runtime.sendMessage({
          type: "OPEN_COMMAND_BAR_FROM_SIDEBAR",
          initialQuery: activeTab.url,
        }).catch(() => {
          sendBackground("createTab", { url: activeTab.url });
        });
      };
      scrollArea.appendChild(urlBox);
    }

    // Favorites grid (bookmark-like)
    const favorites = spaceData.favorites || [];
    if (favorites.length > 0) {
      const favSection = document.createElement("div");
      favSection.className = "arcify-section";
      const favLabel = document.createElement("div");
      favLabel.className = "arcify-section-label";
      favLabel.textContent = "Favorites";
      favSection.appendChild(favLabel);
      const grid = document.createElement("div");
      grid.className = "arcify-favorites-grid";
      grid.addEventListener("dragover", (e) => {
        e.preventDefault();
        grid.classList.add("arcify-drag-over");
      });
      grid.addEventListener("dragleave", () => grid.classList.remove("arcify-drag-over"));
      grid.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        grid.classList.remove("arcify-drag-over");
        const spaceData = state.spaces[state.currentSpace];
        let payload = {};
        try { payload = JSON.parse(e.dataTransfer.getData("application/json") || "{}"); } catch (_) {}

        // Drop a tab into Favorites (adds at end)
        if (payload && payload.dragType === "tab" && payload.tabId != null) {
          const tab = findTabById(spaceData, payload.tabId);
          if (tab && tab.url) {
            addFavoriteAtIndex(spaceData, { url: tab.url, title: tab.customTitle || tab.title || tab.url, favIconUrl: tab.favIconUrl || "" }, spaceData.favorites.length);
            if ((spaceData.pinned || []).some((t) => t && String(t.id) === String(tab.id))) unpinTabInSpace(spaceData, tab.id, tab);
            saveState().then(() => renderPanel());
          }
          return;
        }

        // Reorder favorites by dropping into empty space (moves to end)
        if (payload && payload.dragType === "favorite" && payload.url) {
          const fromIndex = (spaceData.favorites || []).findIndex((f) => f && f.url === payload.url);
          if (fromIndex === -1) return;
          const [moved] = spaceData.favorites.splice(fromIndex, 1);
          spaceData.favorites.push(moved);
          saveState().then(() => renderPanel());
        }
      });
      favorites.forEach((fav) => {
        const tile = document.createElement("button");
        tile.className = "arcify-favorite-tile";
        tile.type = "button";
        tile.dataset.url = fav.url || "";
        tile.draggable = true;
        const favImg = document.createElement("span");
        favImg.className = "arcify-favicon arcify-favicon-tile";
        const img = document.createElement("img");
        img.src = faviconUrl(fav);
        img.alt = "";
        img.onerror = () => { favImg.classList.add("arcify-favicon-missing"); };
        favImg.appendChild(img);
        tile.appendChild(favImg);
        tile.title = fav.title || fav.url || "";
        tile.onclick = () => sendBackground("openFavorite", { url: fav.url });
        tile.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("application/json", JSON.stringify({ dragType: "favorite", url: fav.url }));
          e.dataTransfer.setData("text/plain", String(fav.url || ""));
          e.dataTransfer.setData("text", String(fav.url || ""));
          e.dataTransfer.effectAllowed = "move";
          tile.classList.add("arcify-dragging");
        });
        tile.addEventListener("dragend", () => tile.classList.remove("arcify-dragging"));
        tile.addEventListener("dragover", (e) => {
          e.preventDefault();
          tile.classList.add("arcify-drag-over");
        });
        tile.addEventListener("dragleave", () => tile.classList.remove("arcify-drag-over"));
        tile.addEventListener("drop", (e) => {
          e.preventDefault();
          e.stopPropagation();
          tile.classList.remove("arcify-drag-over");
          const spaceData = state.spaces[state.currentSpace];
          let payload = {};
          try { payload = JSON.parse(e.dataTransfer.getData("application/json") || "{}"); } catch (_) {}

          // Reorder favorites (drop favorite onto another favorite)
          if (payload && payload.dragType === "favorite" && payload.url) {
            const fromIndex = (spaceData.favorites || []).findIndex((f) => f && f.url === payload.url);
            const toIndex = (spaceData.favorites || []).findIndex((f) => f && f.url === fav.url);
            if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;
            const [moved] = spaceData.favorites.splice(fromIndex, 1);
            const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
            spaceData.favorites.splice(insertIndex, 0, moved);
            saveState().then(() => renderPanel());
            return;
          }

          // Drop a tab onto a favorite tile (adds/moves favorite to that spot)
          if (payload && payload.dragType === "tab" && payload.tabId != null) {
            const tab = findTabById(spaceData, payload.tabId);
            if (!tab || !tab.url) return;
            const toIndex = (spaceData.favorites || []).findIndex((f) => f && f.url === fav.url);
            addFavoriteAtIndex(spaceData, { url: tab.url, title: tab.customTitle || tab.title || tab.url, favIconUrl: tab.favIconUrl || "" }, toIndex);
            if ((spaceData.pinned || []).some((t) => t && String(t.id) === String(tab.id))) unpinTabInSpace(spaceData, tab.id, tab);
            saveState().then(() => renderPanel());
          }
        });
        grid.appendChild(tile);
      });
      favSection.appendChild(grid);
      scrollArea.appendChild(favSection);
    }

    // Pinned
    const pinnedSection = document.createElement("div");
    pinnedSection.className = "arcify-section";
    const pinnedLabel = document.createElement("div");
    pinnedLabel.className = "arcify-section-label";
    pinnedLabel.textContent = "Pinned";
    pinnedSection.appendChild(pinnedLabel);
    (spaceData.pinned || []).forEach((tab) => pinnedSection.appendChild(createTabRow(tab, { pinned: true })));
    pinnedSection.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      pinnedSection.classList.add("arcify-drag-over");
    });
    pinnedSection.addEventListener("dragleave", () => pinnedSection.classList.remove("arcify-drag-over"));
    pinnedSection.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      pinnedSection.classList.remove("arcify-drag-over");
      const spaceData = state.spaces[state.currentSpace];
      let payload = {};
      try { payload = JSON.parse(e.dataTransfer.getData("application/json") || "{}"); } catch (_) {}
      const draggedId = payload && payload.dragType === "tab" && payload.tabId != null
        ? payload.tabId
        : parseInt(e.dataTransfer.getData("text/plain") || e.dataTransfer.getData("text"), 10);
      if (!draggedId) return;
      moveTabByDrag(spaceData, draggedId, "pinned", null, null);
      saveState().then(() => renderPanel());
    });
    scrollArea.appendChild(pinnedSection);

    // Folders
    Object.keys(spaceData.folders || {}).forEach((folderName) => {
      const tabs = spaceData.folders[folderName] || [];
      if (tabs.length === 0) return;
      scrollArea.appendChild(createFolderSection(folderName, tabs, spaceData));
    });

    const newFolderBtn = document.createElement("button");
    newFolderBtn.className = "arcify-btn arcify-btn-ghost arcify-new-folder";
    newFolderBtn.textContent = "+ New folder";
    newFolderBtn.onclick = () => {
      const name = prompt("Folder name?", "New folder");
      if (name) {
        sendBackground("addFolder", { folderName: name }).then(() => loadState().then(() => renderPanel()));
      }
    };
    scrollArea.appendChild(newFolderBtn);

    // Tabs
    const tabsSection = document.createElement("div");
    tabsSection.className = "arcify-section";
    const tabsLabel = document.createElement("div");
    tabsLabel.className = "arcify-section-label";
    tabsLabel.textContent = "Tabs";
    tabsSection.appendChild(tabsLabel);
    (spaceData.tabs || []).forEach((tab) => tabsSection.appendChild(createTabRow(tab, { pinned: false })));
    tabsSection.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      tabsSection.classList.add("arcify-drag-over");
    });
    tabsSection.addEventListener("dragleave", () => tabsSection.classList.remove("arcify-drag-over"));
    tabsSection.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      tabsSection.classList.remove("arcify-drag-over");
      const spaceData = state.spaces[state.currentSpace];
      let payload = {};
      try { payload = JSON.parse(e.dataTransfer.getData("application/json") || "{}"); } catch (_) {}
      const draggedId = payload && payload.dragType === "tab" && payload.tabId != null
        ? payload.tabId
        : parseInt(e.dataTransfer.getData("text/plain") || e.dataTransfer.getData("text"), 10);
      if (!draggedId) return;
      moveTabByDrag(spaceData, draggedId, "tabs", null, null);
      saveState().then(() => renderPanel());
    });
    scrollArea.appendChild(tabsSection);

    panel.appendChild(scrollArea);

    // Bottom: New Tab button, then space emojis only
    const footer = document.createElement("div");
    footer.className = "arcify-bottom-bar";
    const newTabBtn = document.createElement("button");
    newTabBtn.type = "button";
    newTabBtn.className = "arcify-new-tab-btn";
    newTabBtn.innerHTML = "<span class=\"arcify-new-tab-plus\">+</span> New Tab";
    newTabBtn.onclick = () => {
      // Open the command bar blank so the user can type a URL for a new tab.
      browser.runtime.sendMessage({
        type: "OPEN_COMMAND_BAR_FROM_SIDEBAR",
        initialQuery: "",
      }).catch(() => {
        // Fallback: create a plain new tab.
        sendBackground("createTab", {});
      });
    };
    footer.appendChild(newTabBtn);
    const spaceStrip = document.createElement("div");
    spaceStrip.className = "arcify-space-strip arcify-space-strip-bottom";
    Object.keys(state.spaces).forEach((name) => {
      const sp = state.spaces[name];
      const icon = (sp && sp.icon) ? sp.icon : "◇";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "arcify-space-emoji-btn" + (name === state.currentSpace ? " arcify-space-emoji-active" : "");
      btn.title = name;
      btn.textContent = icon;
      btn.onclick = () => {
        state.currentSpace = name;
        saveState().then(() => renderPanel());
      };
      spaceStrip.appendChild(btn);
    });
    const newSpaceBtn = document.createElement("button");
    newSpaceBtn.className = "arcify-space-emoji-btn arcify-space-emoji-new";
    newSpaceBtn.type = "button";
    newSpaceBtn.title = "New Space";
    newSpaceBtn.textContent = "+";
    newSpaceBtn.onclick = () => showSpaceSetupModal(false);
    spaceStrip.appendChild(newSpaceBtn);
    footer.appendChild(spaceStrip);
    panel.appendChild(footer);
    if (existingOverlay) panel.appendChild(existingOverlay);

    if (pendingSpaceAnimationDirection && currentScrollArea) {
      const cls = pendingSpaceAnimationDirection === "next"
        ? "arcify-space-anim-next"
        : "arcify-space-anim-prev";
      currentScrollArea.classList.add(cls);
      currentScrollArea.addEventListener("animationend", () => {
        if (currentScrollArea) {
          currentScrollArea.classList.remove("arcify-space-anim-next", "arcify-space-anim-prev");
        }
      }, { once: true });
      pendingSpaceAnimationDirection = null;
    }
  }

  // Two-finger swipe to switch spaces – right = next space, left = prev; less sensitive
  let swipeSum = 0;
  let swipeT0 = 0;
  const SWIPE_THRESHOLD_RIGHT = 95;
  const SWIPE_THRESHOLD_LEFT = 55;
  const SWIPE_WINDOW_MS = 280;
  panel.addEventListener("wheel", (e) => {
    if (!panel.classList.contains("arcify-panel-visible")) return;
    const now = Date.now();
    if (now - swipeT0 > SWIPE_WINDOW_MS) { swipeSum = 0; swipeT0 = now; }
    swipeSum += e.deltaX;
    if (swipeSum >= SWIPE_THRESHOLD_RIGHT) {
      switchSpace("next");
      swipeSum = 0;
      swipeT0 = now;
      e.preventDefault();
    } else if (swipeSum <= -SWIPE_THRESHOLD_LEFT) {
      switchSpace("prev");
      swipeSum = 0;
      swipeT0 = now;
      e.preventDefault();
    }
  }, { passive: false });

  let liveTabsInterval = null;
  function startLiveTabsRefresh() {
    if (liveTabsInterval) return;
    liveTabsInterval = setInterval(() => {
      if (panel.classList.contains("arcify-panel-visible")) loadTabs();
    }, 2500);
  }
  function stopLiveTabsRefresh() {
    if (liveTabsInterval) {
      clearInterval(liveTabsInterval);
      liveTabsInterval = null;
    }
  }

  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", updatePanelSystemTheme);
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message.action === "togglePanel") {
      const show = !panel.classList.contains("arcify-panel-visible");
      panel.classList.toggle("arcify-panel-visible", show);
      updateHostPointerEvents();
      if (show) {
        updatePanelSystemTheme();
        loadState().then(() => loadTabs());
        startLiveTabsRefresh();
      } else {
        stopLiveTabsRefresh();
      }
    } else if (message.action === "refreshTabs") {
      if (panel.classList.contains("arcify-panel-visible")) loadState().then(() => loadTabs());
    } else if (message.action === "copyToClipboard" && message.text) {
      navigator.clipboard.writeText(message.text).catch(() => {});
    } else if (message.action === "contextMenuAction") {
      const { cmd, context } = message;
      if (!context) return;
      const spaceData = state.spaces[state.currentSpace];
      if (cmd === "pin" && context.type === "tab" && spaceData) {
        const { tabId, pinned } = context;
        const tab = [...(spaceData.pinned || []), ...(spaceData.tabs || []), ...Object.values(spaceData.folders || {}).flat()].find((t) => t.id === tabId);
        if (!tab) return;
        if (pinned) unpinTabInSpace(spaceData, tabId, tab);
        else pinTabInSpace(spaceData, tabId, tab);
        saveState().then(() => loadState().then(() => renderPanel()));
      } else if (cmd === "addFav" && context.type === "tab" && context.url && spaceData) {
        if (!(spaceData.favorites || []).some((f) => f.url === context.url)) {
          spaceData.favorites = spaceData.favorites || [];
          spaceData.favorites.push({
            url: context.url,
            title: context.title || context.url,
            favIconUrl: (context.tab && context.tab.favIconUrl) || ""
          });
          // If this tab was pinned, unpin it so Favorites don't also appear in Pinned.
          if (context.pinned && Array.isArray(spaceData.pinned)) {
            const key = String(context.tabId);
            const i = (spaceData.pinned || []).findIndex((t) => t && String(t.id) === key);
            if (i !== -1) {
              const [tab] = spaceData.pinned.splice(i, 1);
              spaceData.tabs = spaceData.tabs || [];
              spaceData.tabs.push(tab);
            }
          }
          saveState().then(() => loadState().then(() => renderPanel()));
        }
      } else if (cmd === "removeFav" && context.type === "tab" && context.url && spaceData) {
        spaceData.favorites = (spaceData.favorites || []).filter((f) => f.url !== context.url);
        saveState().then(() => loadState().then(() => renderPanel()));
      } else if (cmd === "editUrl" && context.tabId && context.tab) {
        const newUrl = prompt("Enter new URL", context.tab.url || "https://");
        if (newUrl) {
          sendBackground("updateTabUrl", { tabId: context.tabId, url: newUrl }).then(() => loadState().then(() => loadTabs()));
        }
      } else if (cmd === "renameTab" && context.tabId && spaceData) {
        const current = (context.tab && (context.tab.customTitle || context.tab.title)) || context.title || "";
        const next = prompt("Tab name?", current);
        if (next === null) return;
        setTabCustomTitle(spaceData, context.tabId, next);
        saveState().then(() => loadState().then(() => renderPanel()));
      } else if (cmd === "moveToNewFolder" && context.tabId) {
        const name = prompt("Folder name?", "New folder");
        if (name) {
          sendBackground("addFolder", { folderName: name }).then(() =>
            sendBackground("moveTabToFolder", { tabId: context.tabId, folderName: name, fromFolder: context.inFolder || undefined })
          ).then(() => loadState().then(() => renderPanel()));
        }
      } else if (cmd === "renameFolder" && context.type === "folder" && context.folderName) {
        const newName = prompt("Folder name?", context.folderName);
        if (newName && newName !== context.folderName) {
          sendBackground("renameFolder", { oldName: context.folderName, newName }).then(() => loadState().then(() => renderPanel()));
        }
      } else if (cmd === "editSpace" && context.type === "space" && context.spaceName) {
        showSpaceSetupModal(true, context.spaceName);
      }
    }
  });
  } // end !isIOS
}
