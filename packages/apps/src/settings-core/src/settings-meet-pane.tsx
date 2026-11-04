import { meetLowDataLabels } from "@/lib/meet-low-data";
import { SettingsPrefsFormPane } from "@/settings-core/src/settings-prefs-form-pane";
import { useSettingsMeetForm } from "@/settings-core/src/use-settings-meet-form";
import { FormField } from "@/ui/form";
import { Label } from "@/ui/label";
import { Switch } from "@/ui/switch";

/** Device setting for Meet. Stored on this browser, not on the account. */
export function SettingsMeetPane() {
  const controller = useSettingsMeetForm();
  return (
    <SettingsPrefsFormPane controller={controller}>
      <p className="text-sm text-muted-foreground">{meetLowDataLabels.hint}</p>
      <FormField
        control={controller.form.control}
        name="lowData"
        render={({ field }) => (
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="meet-low-data">{meetLowDataLabels.mode}</Label>
            <Switch id="meet-low-data" checked={field.value} onCheckedChange={field.onChange} />
          </div>
        )}
      />
    </SettingsPrefsFormPane>
  );
}
