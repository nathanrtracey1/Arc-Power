// Minimal script that runs first: creates #arcify-host and shadow root + panel
// so the panel always exists even if content.js loads later or fails. No extension APIs.
(function () {
  var host = document.getElementById("arcify-host");
  if (host && host.shadowRoot) return;
  if (!host) {
    host = document.createElement("div");
    host.id = "arcify-host";
    host.setAttribute("data-arcify", "bootstrap");
    document.body.appendChild(host);
  }
  host.style.cssText = "position:fixed;left:0;top:0;width:280px;height:100vh;z-index:999999";
  var sr = host.shadowRoot || host.attachShadow({ mode: "open" });
  if (sr.querySelector("#arcify-panel")) return;
  var style = document.createElement("style");
  style.textContent = ".arcify-panel{position:fixed;left:0;top:0;width:280px;height:100vh;background:rgba(28,28,30,.95);color:#fff;z-index:999999;transform:translateX(-100%);transition:transform .24s ease}.arcify-panel.arcify-panel-visible{transform:translateX(0)}";
  sr.appendChild(style);
  var panel = document.createElement("div");
  panel.id = "arcify-panel";
  panel.className = "arcify-panel";
  sr.appendChild(panel);
})();
