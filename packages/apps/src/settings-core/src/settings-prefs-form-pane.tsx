import type { ReactNode } from "react";
import type { FieldValues } from "react-hook-form";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import type { SettingsPrefsForm } from "@/settings-core/src/use-settings-prefs-form";
import { Form } from "@/ui/form";

/** Pane shell for `useSettingsPrefsForm`: card and fields. Changes save themselves. */
export function SettingsPrefsFormPane<T extends FieldValues>({
  controller,
  children,
}: {
  controller: SettingsPrefsForm<T>;
  children: ReactNode;
}) {
  return (
    <Form {...controller.form}>
      <SettingsPaneCard>{children}</SettingsPaneCard>
    </Form>
  );
}
