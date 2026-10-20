/**
 * Device-level colour theme. Stored on this browser, not on the account.
 * `index.html` runs the same resolution inline before first paint; keep the
 * storage key and attribute in sync with that script.
 */
export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

/**
 * Installed window chrome (`theme-color` meta) per scheme: the sidebar surface
 * (`--scheme-sidebar-surface`), so the title bar reads as part of the page.
 * Manifests cannot vary by scheme and carry the light value.
 * `pwa-document-shell.test.ts` guards the copies in `index.html` and CSS.
 */
export const WORKSPACE_PWA_THEME_COLORS = { light: "#fff5e9", dark: "#1c1c1c" } as const;

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

/** Installed window chrome follows the resolved theme. `index.html` ships the meta. */
function applyThemeColorMeta(theme: ResolvedTheme): void {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
  }
  meta.content = WORKSPACE_PWA_THEME_COLORS[theme];
}

/**
 * Keep `data-theme` on <html> and the `theme-color` meta in step with the
 * stored preference and, for System, the OS setting. Call once from the SPA
 * entry. Returns a disposer.
 */
export function syncDocumentTheme(root: HTMLElement = document.documentElement): () => void {
  const apply = () => {
    const theme = resolveTheme(readThemePreference());
    root.dataset.theme = theme;
    applyThemeColorMeta(theme);
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
