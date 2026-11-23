/*
 * Runs before first paint: marks an installed PWA, resolves the theme onto <html>
 * and gives Android its pinch-zoom back. A same-origin file, not inline: the
 * runtime CSP is `script-src 'self'`. Loaded as a classic script before the
 * stylesheet by `index.html` and by `scripts/sync-runtime-app-builds.mjs`.
 */

/*
 * The iOS focus-zoom stop lives in the HTML viewport tag (`maximum-scale=1`), so it
 * holds from the first byte on every iOS browser. Android does not focus-zoom but
 * would honour the limit and lose pinch-zoom, so only Android drops it again.
 */
(function () {
  if (!/Android/i.test(navigator.userAgent)) return;
  var meta = document.querySelector('meta[name="viewport"]');
  if (meta) {
    meta.setAttribute("content", meta.content.replace(/,\s*maximum-scale=[^,]*/, ""));
  }
})();

/*
 * Installed PWA. `styles.css` paints the status bar with the sidebar fill under
 * `html.pwa-standalone`; iOS samples it before module CSS, so it is set here.
 */
(function () {
  if (
    window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  ) {
    document.documentElement.classList.add("pwa-standalone");
  }
})();

/* Theme. Same resolution as `src/lib/theme-preference.ts`. */
(function () {
  var stored = null;
  try {
    stored = localStorage.getItem("wgw.theme");
  } catch (e) {}
  var dark =
    stored === "dark" ||
    (stored !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#10161b" : "#f6f7f9");
})();
