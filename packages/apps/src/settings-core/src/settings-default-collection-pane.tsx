import {
  CalendarEventCalendarPicker,
  defaultPickerCalendarId,
} from "@/lib/calendar-event-calendar-picker";
import { useAppPickerCollections } from "@/lib/app-picker-collections";
import { type DefaultCollectionApp } from "@/lib/default-collection-prefs";
import { settingsWorkspacePaneClasses } from "@/settings-core/src/settings-workspace.styles";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import { useSettingsDefaultCollectionForm } from "@/settings-core/src/use-settings-default-collection-form";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Form, FormField } from "@/ui/form";
import { FormSaveActionRow } from "@/ui/form-save-action-row";

export function SettingsDefaultCollectionPane({ app }: { app: DefaultCollectionApp }) {
  const { form, saveDisplay, meta } = useSettingsDefaultCollectionForm(app);
  const collections = useAppPickerCollections(app);
  const fieldLabel = meta.fieldLabel;

  return (
    <Form {...form}>
      <SettingsPaneCard>
        <div className={settingsWorkspacePaneClasses.stack}>
          {collections.length > 0 ? (
            <FormField
              control={form.control}
              name="collectionId"
              render={({ field }) => (
                <FieldLabelRow label={fieldLabel}>
                  <CalendarEventCalendarPicker
                    calendars={collections}
                    calendarId={defaultPickerCalendarId(collections, field.value || undefined)}
                    label={fieldLabel}
                    showName
                    onCalendarIdChange={(collectionId) => field.onChange(collectionId)}
                  />
                </FieldLabelRow>
              )}
            />
          ) : null}
          <FormSaveActionRow
            className={settingsWorkspacePaneClasses.saveActionRow}
            label="Save"
            disabled={!form.formState.isDirty}
            onSave={saveDisplay}
          />
        </div>
      </SettingsPaneCard>
    </Form>
  );
}

export function SettingsTasksPane() {
  return <SettingsDefaultCollectionPane app="tasks" />;
}

export function SettingsContactsPane() {
  return <SettingsDefaultCollectionPane app="contacts" />;
}

export function SettingsNotesPane() {
  return <SettingsDefaultCollectionPane app="notes" />;
}
