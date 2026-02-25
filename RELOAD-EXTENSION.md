# See the latest Arc Power changes in Safari

Safari caches extensions. After code changes, do this so the **new** sidebar (close buttons, favorites grid, Liquid Glass, spaces at bottom, swipe) appears:

## 1. Quit Safari completely
- **Safari → Quit Safari** (or ⌘Q).
- Make sure Safari is not running (check the Dock).

## 2. In Xcode: clean and run the **Packaged** project
- Open: **ArcifySafari** → **ArcifySafari-Packaged** → **Arcify Safari** → double‑click **Arc Power.xcodeproj**.
- **Product → Clean Build Folder** (⇧⌘K).
- **Product → Run** (⌘R).
- The “Arc Power” app will launch. Leave it running.

## 3. Open Safari again
- Launch Safari.

## 4. Reload the extension (important)
- Go to **Safari → Settings → Extensions**.
- Find **Arc Power Extension**.
- **Uncheck** the box to disable it, then **check** it again to re-enable it.  
  This makes Safari load the newly built extension.

## 5. Reload the page and open the panel
- Open any normal webpage (e.g. https://apple.com).
- Press **⌘B** to open the Arc Power panel.

You should now see:
- **Close (×)** on each tab when you hover
- **Favorites** grid at the top (after you add a tab to Favorites via right‑click)
- **Frosted glass** look (blurred, translucent)
- **Spaces** at the **bottom** of the sidebar with “Swipe with two fingers to switch spaces”
- **Live updates** when you add or close tabs (panel refreshes automatically)

If you still see the old UI, try:
- **Hard refresh** the webpage (⇧⌘R) so the content script is re-injected, then press ⌘B again.
- Restart your Mac, then run the app from Xcode again and open Safari.
