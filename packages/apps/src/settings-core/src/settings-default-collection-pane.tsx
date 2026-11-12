import { useEffect } from "react";
import { defaultPickerCalendarId } from "@/lib/calendar-event-calendar-picker";
import { useAppPickerCollections } from "@/lib/app-picker-collections";
import { type DefaultCollectionApp } from "@/lib/default-collection-prefs";
import { useSettingsDefaultCollectionForm } from "@/settings-core/src/use-settings-default-collection-form";
import { SettingsPrefsFormPane } from "@/settings-core/src/settings-prefs-form-pane";
import { SettingsCollectionSelect } from "@/settings-core/src/settings-collection-select";
import { FieldLabelRow } from "@/ui/field-label-row";
import { FormField } from "@/ui/form";

export function SettingsDefaultCollectionPane({ app }: { app: DefaultCollectionApp }) {
  const controller = useSettingsDefaultCollectionForm(app);
  const { form, meta } = controller;
  const { collections, loaded } = useAppPickerCollections(app);
  const fieldLabel = meta.fieldLabel;
  const collectionWatch = form.watch("collectionId");
  useEffect(() => {
    if (!loaded || collections.length === 0) return;
    const resolved = defaultPickerCalendarId(collections, collectionWatch || undefined);
    if (collectionWatch && resolved && resolved !== collectionWatch) {
      form.setValue("collectionId", resolved, { shouldDirty: true });
    }
  }, [collections, collectionWatch, form, loaded]);

  return (
    <SettingsPrefsFormPane controller={controller}>
      {collections.length > 0 ? (
        <FormField
          control={form.control}
          name="collectionId"
          render={({ field }) => (
            <FieldLabelRow layout="inline" label={fieldLabel} description={meta.description}>
              <SettingsCollectionSelect
                collections={collections}
                value={field.value}
                label={fieldLabel}
                onValueChange={field.onChange}
              />
            </FieldLabelRow>
          )}
        />
      ) : null}
    </SettingsPrefsFormPane>
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
