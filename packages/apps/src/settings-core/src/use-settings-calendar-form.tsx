import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check } from "lucide-react";
import { useForm } from "react-hook-form";
import { useRunWithAppToast } from "@/hooks/use-run-with-app-toast";
import { readCalendarDisplayPrefs, writeCalendarDisplayPrefs } from "@/lib/calendar-display-prefs";
import {
  calendarDisplayFormToPrefs,
  calendarDisplayPrefsToForm,
  settingsCalendarFormSchema,
  type SettingsCalendarFormValues,
} from "@/settings-core/src/settings-calendar-form-schema";
import { notifySettingsSliceSaved } from "@/settings-core/src/settings-slice-saved";

export function useSettingsCalendarForm() {
  const runWithAppToast = useRunWithAppToast();
  const defaultValues = useMemo(() => calendarDisplayPrefsToForm(readCalendarDisplayPrefs()), []);
  const form = useForm<SettingsCalendarFormValues>({
    resolver: zodResolver(settingsCalendarFormSchema),
    defaultValues,
    mode: "onSubmit",
  });

  const saveDisplay = form.handleSubmit(async (values) => {
    await runWithAppToast(
      async () => {
        const prefs = calendarDisplayFormToPrefs(values);
        writeCalendarDisplayPrefs(prefs);
        form.reset(calendarDisplayPrefsToForm(prefs));
        notifySettingsSliceSaved({ panelId: "calendar", sliceId: "calendar-display" });
      },
      {
        success: "Calendar settings saved",
        successOptions: { icon: <Check className="size-4" /> },
        mapError: (error) =>
          error instanceof Error ? error.message : "Could not save Calendar settings",
      },
    );
  });

  return { form, saveDisplay };
}

export type SettingsCalendarFormController = ReturnType<typeof useSettingsCalendarForm>;
