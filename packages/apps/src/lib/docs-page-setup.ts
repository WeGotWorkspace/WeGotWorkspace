import {
  defaultTextEditorPageFormat,
  isTextEditorPageFormat,
  isTextEditorPageLayout,
  isTextEditorPageOrientation,
  type TextEditorPageSetup,
} from "@/lib/page-format";

/**
 * A person's Docs page setup on this device (#1810): paper size, orientation, pages or
 * continuous. Never written into a document. Same device `localStorage` pattern as
 * `calendar-display-prefs`; the app has no account-synced settings store.
 */
export const DOCS_PAGE_SETUP_STORAGE_KEY = "wgw.ui.docs.pageSetup";

const CHANGE_EVENT = "wgw-docs-page-setup";

/** What is stored: only the choices the person made. */
export type DocsPageSetupPrefs = Partial<TextEditorPageSetup>;

function hasWindowStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/** Parse stored JSON. Invalid or unknown values are dropped. */
export function parseDocsPageSetupPrefs(raw: string | null): DocsPageSetupPrefs {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    const prefs: DocsPageSetupPrefs = {};
    if (isTextEditorPageFormat(record.format)) prefs.format = record.format;
    if (isTextEditorPageOrientation(record.orientation)) prefs.orientation = record.orientation;
    if (isTextEditorPageLayout(record.layout)) prefs.layout = record.layout;
    return prefs;
  } catch {
    return {};
  }
}

/**
 * The last choice this tab could not save (private mode, full storage), so the tab still
 * follows it. Cleared by the next saved write or a change from another tab.
 */
let unsavedRaw: string | undefined;

/** Raw stored JSON (or this tab's unsaved choice): a stable `useSyncExternalStore` snapshot. */
export function readDocsPageSetupRaw(): string | null {
  if (unsavedRaw !== undefined) return unsavedRaw;
  if (!hasWindowStorage()) return null;
  try {
    return window.localStorage.getItem(DOCS_PAGE_SETUP_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function readDocsPageSetupPrefs(): DocsPageSetupPrefs {
  return parseDocsPageSetupPrefs(readDocsPageSetupRaw());
}

/**
 * Saves the merged prefs and tells open editors. Returns false when storage is missing
 * or the write throws; this tab then keeps the choice in memory.
 */
export function writeDocsPageSetupPrefs(change: DocsPageSetupPrefs): boolean {
  if (typeof window === "undefined") return false;
  const next = JSON.stringify({ ...readDocsPageSetupPrefs(), ...change });
  let saved = false;
  try {
    if (hasWindowStorage()) {
      window.localStorage.setItem(DOCS_PAGE_SETUP_STORAGE_KEY, next);
      saved = true;
    }
  } catch {
    // Private mode can reject the write.
  }
  unsavedRaw = saved ? undefined : next;
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return saved;
}

function browserLocales(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language ?? ""];
}

/** Stored choices over the defaults: pages on, portrait, Letter or A4 by locale. */
export function resolveDocsPageSetup(
  prefs: DocsPageSetupPrefs,
  locales: readonly string[] = browserLocales(),
): TextEditorPageSetup {
  return {
    format: prefs.format ?? defaultTextEditorPageFormat(locales),
    orientation: prefs.orientation ?? "portrait",
    layout: prefs.layout ?? "pages",
  };
}

/** Same tab (change event) and other tabs (`storage` event). */
export function subscribeDocsPageSetup(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key !== DOCS_PAGE_SETUP_STORAGE_KEY && event.key !== null) return;
    unsavedRaw = undefined;
    listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}
