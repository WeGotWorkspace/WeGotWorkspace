import { meetLowDataLabels } from "@/lib/meet-low-data";
import { SettingsPrefsFormPane } from "@/settings-core/src/settings-prefs-form-pane";
import { useSettingsMeetForm } from "@/settings-core/src/use-settings-meet-form";
import { FieldLabelRow } from "@/ui/field-label-row";
import { FormField } from "@/ui/form";
import { Switch } from "@/ui/switch";

/** Device setting for Meet. Stored on this browser, not on the account. */
export function SettingsMeetPane() {
  const controller = useSettingsMeetForm();
  return (
    <SettingsPrefsFormPane controller={controller}>
      <FormField
        control={controller.form.control}
        name="lowData"
        render={({ field }) => (
          <FieldLabelRow
            layout="inline"
            label={meetLowDataLabels.mode}
            description={meetLowDataLabels.hint}
            htmlFor="meet-low-data"
          >
            <Switch id="meet-low-data" checked={field.value} onCheckedChange={field.onChange} />
          </FieldLabelRow>
        )}
      />
    </SettingsPrefsFormPane>
  );
}
