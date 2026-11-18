import { useEffect, useState } from "react";
import { FieldLabelRow } from "@/ui/field-label-row";
import { useTrackAutosave } from "@/ui/autosave-status";
import { CollectionGhostSelectTrigger } from "@/ui/collection-ghost-select";
import { Select, SelectContent, SelectItem, SelectValue } from "@/ui/select";
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
  const trackSave = useTrackAutosave();

  useEffect(() => {
    const apply = () => setPreference(readThemePreference());
    apply();
    return subscribeThemePreference(apply);
  }, []);

  return (
    <SettingsPaneCard>
      <FieldLabelRow
        layout="inline"
        label="Theme"
        description="Light, dark, or follow your system. Saved on this device."
      >
        <Select
          value={preference}
          onValueChange={(value) => {
            if (isThemePreference(value)) void trackSave(() => writeThemePreference(value));
          }}
        >
          <CollectionGhostSelectTrigger aria-label="Theme" label={<SelectValue />} />
          <SelectContent align="end">
            {THEME_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldLabelRow>
    </SettingsPaneCard>
  );
}
