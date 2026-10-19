import { useEffect, useState } from "react";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import {
  readThemePreference,
  subscribeThemePreference,
  writeThemePreference,
  type ThemePreference,
} from "@/lib/theme-preference";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "Auto (System)" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function isThemePreference(value: string): value is ThemePreference {
  return THEME_OPTIONS.some((option) => option.value === value);
}

/** Device setting for the colour theme. Stored on this browser, not on the account. */
export function SettingsAppearancePane() {
  const [preference, setPreference] = useState<ThemePreference>("system");

  useEffect(() => {
    const apply = () => setPreference(readThemePreference());
    apply();
    return subscribeThemePreference(apply);
  }, []);

  return (
    <SettingsPaneCard>
      <div className="settings-appearance-pane max-w-lg space-y-4">
        <FieldLabelRow label="Theme">
          <Select
            value={preference}
            onValueChange={(value) => {
              if (isThemePreference(value)) writeThemePreference(value);
            }}
          >
            <SelectTrigger aria-label="Theme">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {THEME_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldLabelRow>
      </div>
    </SettingsPaneCard>
  );
}
