/*
 * Runs before first paint: resolves the theme onto <html> and stops the iOS
 * focus zoom. A same-origin file, not inline: the runtime CSP is
 * `script-src 'self'`. Loaded as a classic script before the stylesheet by
 * `index.html` and by `scripts/sync-runtime-app-builds.mjs`.
 */

/*
 * The one iOS focus-zoom fix for the suite. iOS Safari zooms the page when a
 * field under 16px gets focus; `maximum-scale=1` stops that, so fields keep
 * their desktop size on phones. iOS still lets people pinch-zoom (it ignores
 * the limit for user gestures; checked in the iOS Simulator). iOS only:
 * Android would honour the limit and lose pinch-zoom, and does not focus-zoom.
 */
(function () {
  var ua = navigator.userAgent;
  var ios =
    /iP(hone|ad|od)/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!ios) return;
  var meta = document.querySelector('meta[name="viewport"]');
  if (meta && !/maximum-scale/.test(meta.content)) {
    meta.setAttribute("content", meta.content + ", maximum-scale=1");
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
