import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  parseDocsPageSetupOverrides,
  parseDocsPageSetupPrefs,
  readDocsPageSetupOverridesRaw,
  readDocsPageSetupRaw,
  resolveDocPageSetup,
  subscribeDocsPageSetup,
  writeDocsPageSetupOverride,
  writeDocsPageSetupPrefs,
  type DocsPageSetupPrefs,
} from "@/lib/docs-page-setup";
import { useIsMobile } from "@/hooks/use-mobile";
import type { TextEditorPageSetup } from "@/lib/page-format";

export type DocsPageSetupState = {
  pageSetup: TextEditorPageSetup;
  setPageSetup: (change: DocsPageSetupPrefs) => void;
};

function useDocsPageSetupRecords() {
  const defaultRaw = useSyncExternalStore(subscribeDocsPageSetup, readDocsPageSetupRaw, () => null);
  const overridesRaw = useSyncExternalStore(
    subscribeDocsPageSetup,
    readDocsPageSetupOverridesRaw,
    () => null,
  );
  return useMemo(
    () => ({
      prefs: parseDocsPageSetupPrefs(defaultRaw),
      overrides: parseDocsPageSetupOverrides(overridesRaw),
    }),
    [defaultRaw, overridesRaw],
  );
}

/**
 * One document's page setup, live across editors and tabs on this device: its own choice,
 * else the default from Docs settings. A change applies to this document only. Without a
 * path (a preview), it shows and changes the default. Phones always get the continuous
 * sheet: a page does not fit. The paper choice still sets print.
 */
export function useDocsPageSetup(docPath?: string | null): DocsPageSetupState {
  const { prefs, overrides } = useDocsPageSetupRecords();
  const isMobile = useIsMobile();
  const resolved = useMemo(
    () => resolveDocPageSetup(docPath, prefs, overrides),
    [docPath, prefs, overrides],
  );
  const pageSetup = useMemo(
    () => (isMobile ? { ...resolved, layout: "continuous" as const } : resolved),
    [resolved, isMobile],
  );
  const setPageSetup = useCallback(
    (change: DocsPageSetupPrefs) => {
      if (!docPath) {
        writeDocsPageSetupPrefs(change);
        return;
      }
      writeDocsPageSetupOverride(docPath, {
        format: change.format ?? resolved.format,
        orientation: change.orientation ?? resolved.orientation,
      });
    },
    [docPath, resolved],
  );
  return { pageSetup, setPageSetup };
}
