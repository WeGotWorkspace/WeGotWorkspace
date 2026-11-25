import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  readDocsPageSetupPrefs,
  resolveDocsPageSetup,
  subscribeDocsPageSetup,
  writeDocsPageSetupPrefs,
} from "@/lib/docs-page-setup";
import {
  isDocsFormatBarPlacement,
  readDocsFormatBarPlacement,
  subscribeDocsFormatBarPlacement,
  writeDocsFormatBarPlacement,
  type DocsFormatBarPlacement,
} from "@/lib/docs-format-bar-placement";
import { docsPageSetupLabels as labels } from "@/lib/docs-page-setup-labels";
import {
  isTextEditorPageOrientation,
  isTextEditorPaperChoice,
  type TextEditorPageOrientation,
  type TextEditorPaperChoice,
} from "@/lib/page-format";
import { useSettingsPrefsForm } from "@/settings-core/src/use-settings-prefs-form";

export const settingsDocsFormSchema = z.object({
  format: z.custom<TextEditorPaperChoice>(isTextEditorPaperChoice),
  orientation: z.custom<TextEditorPageOrientation>(isTextEditorPageOrientation),
  formatBar: z.custom<DocsFormatBarPlacement>(isDocsFormatBarPlacement),
});

export type SettingsDocsFormValues = z.infer<typeof settingsDocsFormSchema>;

const resolver = zodResolver(settingsDocsFormSchema);

function readDocsDefault(): SettingsDocsFormValues {
  const { format, orientation } = resolveDocsPageSetup(readDocsPageSetupPrefs());
  return { format, orientation, formatBar: readDocsFormatBarPlacement() };
}

function writeDocsDefault({ formatBar, ...pageSetup }: SettingsDocsFormValues): boolean {
  const pageSaved = writeDocsPageSetupPrefs(pageSetup);
  return writeDocsFormatBarPlacement(formatBar) && pageSaved;
}

/** Page setup and the formatting bar's place are both device settings of the Docs pane. */
function subscribeDocsDefault(listener: () => void): () => void {
  const stopPageSetup = subscribeDocsPageSetup(listener);
  const stopFormatBar = subscribeDocsFormatBarPlacement(listener);
  return () => {
    stopPageSetup();
    stopFormatBar();
  };
}

/** Docs device settings: the paper and orientation new documents start with, and the formatting bar's place. */
export function useSettingsDocsForm() {
  return useSettingsPrefsForm<SettingsDocsFormValues>({
    resolver,
    read: readDocsDefault,
    write: writeDocsDefault,
    subscribe: subscribeDocsDefault,
    saved: { panelId: "docs", sliceId: "docs-page-setup" },
    saveError: labels.settingsSaveError,
  });
}
