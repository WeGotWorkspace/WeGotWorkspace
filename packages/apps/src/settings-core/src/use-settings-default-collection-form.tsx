import { zodResolver } from "@hookform/resolvers/zod";
import {
  DEFAULT_COLLECTION_APP_META,
  type DefaultCollectionApp,
  writeDefaultCollectionPrefs,
} from "@/lib/default-collection-prefs";
import {
  defaultCollectionFormToPrefs,
  defaultCollectionPrefsToForm,
  settingsDefaultCollectionFormSchema,
  type SettingsDefaultCollectionFormValues,
} from "@/settings-core/src/settings-default-collection-form-schema";
import { useSettingsPrefsForm } from "@/settings-core/src/use-settings-prefs-form";

const resolver = zodResolver(settingsDefaultCollectionFormSchema);

export function useSettingsDefaultCollectionForm(app: DefaultCollectionApp) {
  const meta = DEFAULT_COLLECTION_APP_META[app];
  const controller = useSettingsPrefsForm<SettingsDefaultCollectionFormValues>({
    resolver,
    read: () => defaultCollectionPrefsToForm(app),
    write: (values) => writeDefaultCollectionPrefs(app, defaultCollectionFormToPrefs(values)),
    saved: { panelId: app, sliceId: `${app}-default-collection` },
    messages: { success: meta.savedMessage, error: meta.saveError },
  });
  return { ...controller, meta };
}

export type SettingsDefaultCollectionFormController = ReturnType<
  typeof useSettingsDefaultCollectionForm
>;
