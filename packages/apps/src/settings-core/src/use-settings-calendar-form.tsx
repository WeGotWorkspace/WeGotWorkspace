import { zodResolver } from "@hookform/resolvers/zod";
import { readCalendarDisplayPrefs, writeCalendarDisplayPrefs } from "@/lib/calendar-display-prefs";
import {
  calendarDisplayFormToPrefs,
  calendarDisplayPrefsToForm,
  settingsCalendarFormSchema,
  type SettingsCalendarFormValues,
} from "@/settings-core/src/settings-calendar-form-schema";
import { useSettingsPrefsForm } from "@/settings-core/src/use-settings-prefs-form";

const resolver = zodResolver(settingsCalendarFormSchema);

export function useSettingsCalendarForm() {
  return useSettingsPrefsForm<SettingsCalendarFormValues>({
    resolver,
    read: () => calendarDisplayPrefsToForm(readCalendarDisplayPrefs()),
    write: (values) => writeCalendarDisplayPrefs(calendarDisplayFormToPrefs(values)),
    saved: { panelId: "calendar", sliceId: "calendar-display" },
    messages: {
      success: "Calendar settings saved",
      error: "Could not save Calendar settings",
    },
  });
}

export type SettingsCalendarFormController = ReturnType<typeof useSettingsCalendarForm>;
