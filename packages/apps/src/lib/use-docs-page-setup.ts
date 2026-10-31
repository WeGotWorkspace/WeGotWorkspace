import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  DOCS_PAGE_SETUP_STORAGE_KEY,
  parseDocsPageSetupPrefs,
  resolveDocsPageSetup,
  subscribeDocsPageSetup,
  writeDocsPageSetupPrefs,
  type DocsPageSetupPrefs,
} from "@/lib/docs-page-setup";
import { useIsMobile } from "@/hooks/use-mobile";
import type { TextEditorPageSetup } from "@/lib/page-format";

/** Raw stored string: a stable snapshot for `useSyncExternalStore`. */
function readRawPageSetup(): string | null {
  try {
    return window.localStorage.getItem(DOCS_PAGE_SETUP_STORAGE_KEY);
  } catch {
    return null;
  }
}

export type DocsPageSetupState = {
  pageSetup: TextEditorPageSetup;
  setPageSetup: (change: DocsPageSetupPrefs) => void;
};

/**
 * The person's page setup, live across editors and tabs on this device. Phones always
 * get the continuous sheet: a page does not fit (the menu is hidden there too).
 */
export function useDocsPageSetup(): DocsPageSetupState {
  const raw = useSyncExternalStore(subscribeDocsPageSetup, readRawPageSetup, () => null);
  const isMobile = useIsMobile();
  const pageSetup = useMemo(() => {
    const resolved = resolveDocsPageSetup(parseDocsPageSetupPrefs(raw));
    return isMobile ? { ...resolved, layout: "continuous" as const } : resolved;
  }, [raw, isMobile]);
  const setPageSetup = useCallback((change: DocsPageSetupPrefs) => {
    writeDocsPageSetupPrefs(change);
  }, []);
  return { pageSetup, setPageSetup };
}
