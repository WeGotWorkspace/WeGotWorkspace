/*
 * Resolves the theme onto <html> before first paint. Same resolution as
 * `src/lib/theme-preference.ts`. A same-origin file, not inline: the runtime
 * CSP is `script-src 'self'`. Loaded as a classic script before the stylesheet
 * by `index.html` and by `scripts/sync-runtime-app-builds.mjs`.
 */
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
  if (meta) meta.setAttribute("content", dark ? "#1c1c1c" : "#fff5e9");
})();
