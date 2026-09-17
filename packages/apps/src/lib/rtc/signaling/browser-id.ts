const STORAGE_KEY = "wgw.rtc.browserId";
const BROWSER_ID_PATTERN = /^[a-f0-9]{32}$/;

/** Stable per browser profile (localStorage). New tab/reload reuse it; another device does not. */
export function readRtcBrowserId(): string | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing && BROWSER_ID_PATTERN.test(existing)) return existing;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const next = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(STORAGE_KEY, next);
    return next;
  } catch {
    return undefined;
  }
}
