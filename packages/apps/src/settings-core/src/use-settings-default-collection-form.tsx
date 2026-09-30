import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check } from "lucide-react";
import { useForm } from "react-hook-form";
import { useRunWithAppToast } from "@/hooks/use-run-with-app-toast";
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
import { notifySettingsSliceSaved } from "@/settings-core/src/settings-slice-saved";
import { useRegisterSettingsDialogSave } from "@/settings-core/src/settings-dialog-pane-actions";

export function useSettingsDefaultCollectionForm(app: DefaultCollectionApp) {
  const runWithAppToast = useRunWithAppToast();
  const meta = DEFAULT_COLLECTION_APP_META[app];
  const defaultValues = useMemo(() => defaultCollectionPrefsToForm(app), [app]);
  const form = useForm<SettingsDefaultCollectionFormValues>({
    resolver: zodResolver(settingsDefaultCollectionFormSchema),
    defaultValues,
    mode: "onSubmit",
  });

  const saveDisplay = form.handleSubmit(async (values) => {
    await runWithAppToast(
      async () => {
        const prefs = defaultCollectionFormToPrefs(values);
        if (!writeDefaultCollectionPrefs(app, prefs)) {
          throw new Error(meta.saveError);
        }
        form.reset(defaultCollectionPrefsToForm(app));
        notifySettingsSliceSaved({ panelId: app, sliceId: `${app}-default-collection` });
      },
      {
        success: meta.savedMessage,
        successOptions: { icon: <Check className="size-4" /> },
        mapError: (error) => (error instanceof Error ? error.message : meta.saveError),
      },
    );
  });

  useRegisterSettingsDialogSave(saveDisplay, !form.formState.isDirty);

  return { form, saveDisplay, meta };
}

export type SettingsDefaultCollectionFormController = ReturnType<
  typeof useSettingsDefaultCollectionForm
>;
