import {
  defaultTextEditorPageFormat,
  isTextEditorPaperChoice,
  isTextEditorPageOrientation,
  type TextEditorPageOrientation,
  type TextEditorPageSetup,
  type TextEditorPaperChoice,
} from "@/lib/page-format";
import { normalizeApiVirtualPath } from "@/lib/files/api-path";

/**
 * A person's Docs page setup on this device (#1810): paper size (or `none` for no pages)
 * and orientation. Never written into a document. Same device `localStorage` pattern as
 * `calendar-display-prefs`; the app has no account-synced settings store.
 *
 * Two records: the default (Docs settings), which new documents start with, and an
 * override per document (Page setup in the document's header), keyed by its path.
 * Fit to screen is about this screen, not the document, so it lives in the default only.
 */
export const DOCS_PAGE_SETUP_STORAGE_KEY = "wgw.ui.docs.pageSetup";
export const DOCS_PAGE_SETUP_OVERRIDES_KEY = "wgw.ui.docs.pageSetup.byDoc";
/** Oldest overrides go first beyond this, so the record stays small. */
export const DOCS_PAGE_SETUP_MAX_OVERRIDES = 300;

const CHANGE_EVENT = "wgw-docs-page-setup";

/** What is stored: only the choices the person made. Pages show unless the paper is `none`. */
export type DocsPageSetupPrefs = {
  format?: TextEditorPaperChoice;
  orientation?: TextEditorPageOrientation;
  /** Shrink pages wider than the screen or pane to fit it; on when unset. For every document. */
  fitToScreen?: boolean;
};

/** One document's own page setup: both choices, so a later default change leaves it alone. */
export type DocsPageSetupOverride = {
  format: TextEditorPaperChoice;
  orientation: TextEditorPageOrientation;
  /** Last change (ms), to drop the oldest first. */
  at: number;
};

export type DocsPageSetupOverrides = Record<string, DocsPageSetupOverride>;

function hasWindowStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseRecord(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Parse stored JSON. Invalid or unknown values are dropped. */
export function parseDocsPageSetupPrefs(raw: string | null): DocsPageSetupPrefs {
  const record = parseRecord(raw);
  if (!record) return {};
  const prefs: DocsPageSetupPrefs = {};
  if (isTextEditorPaperChoice(record.format)) prefs.format = record.format;
  if (isTextEditorPageOrientation(record.orientation)) prefs.orientation = record.orientation;
  if (typeof record.fitToScreen === "boolean") prefs.fitToScreen = record.fitToScreen;
  // Before `none` there was a separate Pages / Continuous switch.
  if (record.layout === "continuous") prefs.format = "none";
  return prefs;
}

/** Parse the per-document record. Entries missing a choice are dropped. */
export function parseDocsPageSetupOverrides(raw: string | null): DocsPageSetupOverrides {
  const record = parseRecord(raw);
  if (!record) return {};
  const overrides: DocsPageSetupOverrides = {};
  for (const [path, value] of Object.entries(record)) {
    const entry = asRecord(value);
    if (!entry) continue;
    if (!isTextEditorPaperChoice(entry.format) || !isTextEditorPageOrientation(entry.orientation)) {
      continue;
    }
    const at = typeof entry.at === "number" && Number.isFinite(entry.at) ? entry.at : 0;
    overrides[path] = { format: entry.format, orientation: entry.orientation, at };
  }
  return overrides;
}

/** One `localStorage` key that tells open editors (this tab and others) about changes. */
function deviceRecord(key: string) {
  /**
   * The last value this tab could not save (private mode, full storage), so the tab still
   * follows it. Cleared by the next saved write or a change from another tab.
   */
  let unsavedRaw: string | undefined;
  return {
    key,
    read(): string | null {
      if (unsavedRaw !== undefined) return unsavedRaw;
      if (!hasWindowStorage()) return null;
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    /** Returns false when storage is missing or the write throws; this tab keeps the value. */
    write(next: string): boolean {
      if (typeof window === "undefined") return false;
      let saved = false;
      try {
        if (hasWindowStorage()) {
          window.localStorage.setItem(key, next);
          saved = true;
        }
      } catch {
        // Private mode can reject the write.
      }
      unsavedRaw = saved ? undefined : next;
      window.dispatchEvent(new Event(CHANGE_EVENT));
      return saved;
    },
    forgetUnsaved() {
      unsavedRaw = undefined;
    },
  };
}

const defaults = deviceRecord(DOCS_PAGE_SETUP_STORAGE_KEY);
const overrides = deviceRecord(DOCS_PAGE_SETUP_OVERRIDES_KEY);

/** Raw stored default (or this tab's unsaved choice): a stable `useSyncExternalStore` snapshot. */
export function readDocsPageSetupRaw(): string | null {
  return defaults.read();
}

export function readDocsPageSetupPrefs(): DocsPageSetupPrefs {
  return parseDocsPageSetupPrefs(readDocsPageSetupRaw());
}

/** Saves the merged default and tells open editors. False when it stays in this tab only. */
export function writeDocsPageSetupPrefs(change: DocsPageSetupPrefs): boolean {
  return defaults.write(JSON.stringify({ ...readDocsPageSetupPrefs(), ...change }));
}

/** Raw per-document record: a stable `useSyncExternalStore` snapshot. */
export function readDocsPageSetupOverridesRaw(): string | null {
  return overrides.read();
}

export function readDocsPageSetupOverrides(): DocsPageSetupOverrides {
  return parseDocsPageSetupOverrides(readDocsPageSetupOverridesRaw());
}

/** Stable key for a document: its normalized API path. */
export function docsPageSetupDocKey(path: string): string {
  return normalizeApiVirtualPath(path);
}

function writeOverrides(next: DocsPageSetupOverrides): boolean {
  const kept = Object.entries(next)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, DOCS_PAGE_SETUP_MAX_OVERRIDES);
  return overrides.write(JSON.stringify(Object.fromEntries(kept)));
}

/** Gives one document its own page setup. */
export function writeDocsPageSetupOverride(
  path: string,
  setup: Pick<DocsPageSetupOverride, "format" | "orientation">,
  now: number = Date.now(),
): boolean {
  return writeOverrides({
    ...readDocsPageSetupOverrides(),
    [docsPageSetupDocKey(path)]: { format: setup.format, orientation: setup.orientation, at: now },
  });
}

/**
 * A renamed or moved document keeps its own page setup, and so does every document under a
 * renamed or moved folder. A second call for a path that is already gone changes nothing.
 */
export function moveDocsPageSetupOverride(from: string, to: string): boolean {
  const current = readDocsPageSetupOverrides();
  const fromKey = docsPageSetupDocKey(from);
  const toKey = docsPageSetupDocKey(to);
  if (fromKey === toKey) return false;
  const prefix = fromKey === "/" ? "/" : `${fromKey}/`;
  const next: DocsPageSetupOverrides = {};
  let moved = false;
  for (const [key, entry] of Object.entries(current)) {
    if (key === fromKey || key.startsWith(prefix)) {
      const rest = key.slice(fromKey.length);
      next[toKey === "/" ? rest || "/" : `${toKey}${rest}`] = entry;
      moved = true;
    } else if (!(key in next)) {
      next[key] = entry;
    }
  }
  return moved && writeOverrides(next);
}

function browserLocales(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language ?? ""];
}

/**
 * Stored choices over the defaults: portrait, Letter or A4 by locale; pages unless `none`,
 * fitted to the screen unless turned off.
 */
export function resolveDocsPageSetup(
  prefs: DocsPageSetupPrefs,
  locales: readonly string[] = browserLocales(),
): TextEditorPageSetup {
  const format = prefs.format ?? defaultTextEditorPageFormat(locales);
  const layout = format === "none" ? "continuous" : "pages";
  return {
    format,
    orientation: prefs.orientation ?? "portrait",
    layout,
    // On unless turned off: pages shrink to the screen or pane by default.
    ...(layout === "pages" && prefs.fitToScreen !== false ? { fitToScreen: true } : {}),
  };
}

/** A document's page setup: its own if it has one, else the default. */
export function resolveDocPageSetup(
  path: string | null | undefined,
  prefs: DocsPageSetupPrefs,
  docOverrides: DocsPageSetupOverrides,
  locales: readonly string[] = browserLocales(),
): TextEditorPageSetup {
  const own = path ? docOverrides[docsPageSetupDocKey(path)] : undefined;
  return resolveDocsPageSetup(
    own
      ? { format: own.format, orientation: own.orientation, fitToScreen: prefs.fitToScreen }
      : prefs,
    locales,
  );
}

/** A new document starts with the default, and keeps it when the default changes later. */
export function startDocWithDefaultPageSetup(path: string): boolean {
  const { format, orientation } = resolveDocsPageSetup(readDocsPageSetupPrefs());
  return writeDocsPageSetupOverride(path, { format, orientation });
}

/** Both records, this tab (change event) and other tabs (`storage` event). */
export function subscribeDocsPageSetup(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === null) {
      defaults.forgetUnsaved();
      overrides.forgetUnsaved();
    } else if (event.key === defaults.key) {
      defaults.forgetUnsaved();
    } else if (event.key === overrides.key) {
      overrides.forgetUnsaved();
    } else {
      return;
    }
    listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}
