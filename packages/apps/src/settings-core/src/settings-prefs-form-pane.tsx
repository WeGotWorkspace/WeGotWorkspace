import type { ReactNode } from "react";
import type { FieldValues } from "react-hook-form";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import { settingsWorkspacePaneClasses } from "@/settings-core/src/settings-workspace.styles";
import type { SettingsPrefsForm } from "@/settings-core/src/use-settings-prefs-form";
import { Form } from "@/ui/form";
import { FormSaveActionRow } from "@/ui/form-save-action-row";

/** Pane shell for `useSettingsPrefsForm`: card, field stack, and the Save row. */
export function SettingsPrefsFormPane<T extends FieldValues>({
  controller,
  children,
}: {
  controller: SettingsPrefsForm<T>;
  children: ReactNode;
}) {
  const { form, save } = controller;
  return (
    <Form {...form}>
      <SettingsPaneCard>
        <div className={settingsWorkspacePaneClasses.stack}>
          {children}
          <FormSaveActionRow
            className={settingsWorkspacePaneClasses.saveActionRow}
            label="Save"
            disabled={!form.formState.isDirty}
            onSave={save}
          />
        </div>
      </SettingsPaneCard>
    </Form>
  );
}
