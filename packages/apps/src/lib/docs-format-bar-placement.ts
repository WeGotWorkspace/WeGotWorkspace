import { useSyncExternalStore } from "react";

/**
 * Where the Docs format bar sits: `top` = the bar above the page, `selection` = a bar that
 * floats over the selected text. Stored on this device, like the page setup default.
 */
export type DocsFormatBarPlacement = "top" | "selection";

export const DOCS_FORMAT_BAR_PLACEMENT_KEY = "wgw.ui.docs.formatBar";
const CHANGE_EVENT = "wgw:docs-format-bar-placement";

export function isDocsFormatBarPlacement(value: unknown): value is DocsFormatBarPlacement {
  return value === "top" || value === "selection";
}

/** What an unset device gets: the bar on top, as before. */
export const DEFAULT_DOCS_FORMAT_BAR_PLACEMENT: DocsFormatBarPlacement = "top";

let unsaved: string | undefined;

function readRaw(): string | null {
  if (unsaved !== undefined) return unsaved;
  try {
    return window.localStorage.getItem(DOCS_FORMAT_BAR_PLACEMENT_KEY);
  } catch {
    return null;
  }
}

export function readDocsFormatBarPlacement(): DocsFormatBarPlacement {
  if (typeof window === "undefined") return DEFAULT_DOCS_FORMAT_BAR_PLACEMENT;
  const raw = readRaw();
  return isDocsFormatBarPlacement(raw) ? raw : DEFAULT_DOCS_FORMAT_BAR_PLACEMENT;
}

/** Returns false when storage rejects the write; this tab keeps following the value. */
export function writeDocsFormatBarPlacement(next: DocsFormatBarPlacement): boolean {
  if (typeof window === "undefined") return false;
  let saved = false;
  try {
    window.localStorage.setItem(DOCS_FORMAT_BAR_PLACEMENT_KEY, next);
    saved = true;
  } catch {
    // Private mode can reject the write.
  }
  unsaved = saved ? undefined : next;
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return saved;
}

/** This tab (change event) and other tabs (`storage` event). */
export function subscribeDocsFormatBarPlacement(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== DOCS_FORMAT_BAR_PLACEMENT_KEY) return;
    unsaved = undefined;
    listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useDocsFormatBarPlacement(): DocsFormatBarPlacement {
  return useSyncExternalStore(
    subscribeDocsFormatBarPlacement,
    readDocsFormatBarPlacement,
    () => DEFAULT_DOCS_FORMAT_BAR_PLACEMENT,
  );
}
