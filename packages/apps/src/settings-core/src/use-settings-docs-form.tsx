import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  readDocsPageSetupPrefs,
  resolveDocsPageSetup,
  subscribeDocsPageSetup,
  writeDocsPageSetupPrefs,
} from "@/lib/docs-page-setup";
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
});

export type SettingsDocsFormValues = z.infer<typeof settingsDocsFormSchema>;

const resolver = zodResolver(settingsDocsFormSchema);

function readDocsDefault(): SettingsDocsFormValues {
  const { format, orientation } = resolveDocsPageSetup(readDocsPageSetupPrefs());
  return { format, orientation };
}

/** Docs default page setup: the paper and orientation new documents start with. */
export function useSettingsDocsForm() {
  return useSettingsPrefsForm<SettingsDocsFormValues>({
    resolver,
    read: readDocsDefault,
    write: writeDocsPageSetupPrefs,
    subscribe: subscribeDocsPageSetup,
    saved: { panelId: "docs", sliceId: "docs-page-setup" },
    messages: { success: labels.settingsSaved, error: labels.settingsSaveError },
  });
}
