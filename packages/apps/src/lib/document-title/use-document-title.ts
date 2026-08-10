import { useEffect, useRef } from "react";
import { formatBrowserTitle } from "@/lib/document-title/format-browser-title";

/** Default delay before applying title changes while the open item's body is edited. */
export const DOCUMENT_TITLE_DEBOUNCE_MS = 400;

export type UseDocumentTitleOptions = {
  /** Delay before applying context changes; omit or 0 for immediate updates. */
  debounceMs?: number;
  /**
   * When this identity changes (e.g. active note id), apply the title immediately
   * instead of waiting for the debounce.
   */
  flushKey?: string | number | null | undefined;
};

const FLUSH_KEY_UNSET = Symbol("document-title-flush-unset");

/** Sets `document.title` from workspace context; restores on unmount. */
export function useDocumentTitle(context?: string, options?: UseDocumentTitleOptions): void {
  const debounceMs = options?.debounceMs ?? 0;
  const flushKey = options?.flushKey;
  const prevFlushKeyRef = useRef<typeof flushKey | typeof FLUSH_KEY_UNSET>(FLUSH_KEY_UNSET);
  const mountTitleRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;

    if (mountTitleRef.current === null) {
      mountTitleRef.current = document.title;
    }

    const flushKeyChanged = prevFlushKeyRef.current !== flushKey;
    prevFlushKeyRef.current = flushKey;

    const apply = () => {
      document.title = formatBrowserTitle(context);
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (debounceMs > 0 && !flushKeyChanged) {
      timer = setTimeout(apply, debounceMs);
    } else {
      apply();
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [context, debounceMs, flushKey]);

  useEffect(() => {
    return () => {
      if (mountTitleRef.current !== null && typeof document !== "undefined") {
        document.title = mountTitleRef.current;
      }
    };
  }, []);
}
