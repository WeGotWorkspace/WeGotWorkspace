/**
 * Device-level colour theme. Stored on this browser, not on the account.
 * `index.html` runs the same resolution inline before first paint; keep the
 * storage key and attribute in sync with that script.
 */
export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "wgw.theme";
const CHANGE_EVENT = "wgw-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function readThemePreference(): ThemePreference {
  if (typeof localStorage === "undefined") return "system";
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function writeThemePreference(preference: ThemePreference): void {
  if (typeof localStorage !== "undefined") {
    try {
      if (preference === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Private mode can reject the write; the in-memory listeners still update.
    }
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function subscribeThemePreference(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Keep `data-theme` on <html> in step with the stored preference and, for
 * System, the OS setting. Call once from the SPA entry. Returns a disposer.
 */
export function syncDocumentTheme(root: HTMLElement = document.documentElement): () => void {
  const apply = () => {
    root.dataset.theme = resolveTheme(readThemePreference());
  };
  apply();
  const unsubscribe = subscribeThemePreference(apply);
  const media = typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;
  media?.addEventListener("change", apply);
  return () => {
    unsubscribe();
    media?.removeEventListener("change", apply);
  };
}
