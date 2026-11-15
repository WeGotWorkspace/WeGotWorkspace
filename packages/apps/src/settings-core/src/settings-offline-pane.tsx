import { useEffect, useState } from "react";
import { Switch } from "@/ui/switch";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import {
  mbToOfflineFileSizeBytes,
  maxOfflineFileSizeMb,
  readOfflineDeviceContentSettings,
  writeOfflineDeviceContentSettings,
} from "@/lib/offline/core/offline-device-settings";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";

export function SettingsOfflinePane() {
  const [contentSyncEnabled, setContentSyncEnabled] = useState(true);
  const [maxFileSizeMb, setMaxFileSizeMb] = useState(8);

  useEffect(() => {
    const settings = readOfflineDeviceContentSettings();
    setContentSyncEnabled(settings.contentSyncEnabled);
    setMaxFileSizeMb(maxOfflineFileSizeMb(settings));
  }, []);

  const persist = (next: { contentSyncEnabled?: boolean; maxFileSizeMb?: number }) => {
    const enabled = next.contentSyncEnabled ?? contentSyncEnabled;
    const mb = next.maxFileSizeMb ?? maxFileSizeMb;
    setContentSyncEnabled(enabled);
    setMaxFileSizeMb(mb);
    writeOfflineDeviceContentSettings({
      contentSyncEnabled: enabled,
      maxFileSizeBytes: mbToOfflineFileSizeBytes(mb),
    });
  };

  return (
    <SettingsPaneCard>
      <p className="text-sm text-muted-foreground">
        Folder and file names sync automatically for Drive and Docs. These settings control whether
        file contents are saved on this device for offline use.
      </p>
      <FieldLabelRow
        layout="inline"
        label="Make files available offline"
        description="Automatically save file contents up to the max size below."
        htmlFor="offline-content-sync"
      >
        <Switch
          id="offline-content-sync"
          checked={contentSyncEnabled}
          onCheckedChange={(checked) => persist({ contentSyncEnabled: checked })}
        />
      </FieldLabelRow>
      <FieldLabelRow
        layout="inline"
        label="Max file size (MB)"
        description="Files larger than this limit are not synced automatically. You can pin them manually from Drive while online."
        htmlFor="offline-max-size"
      >
        <Input
          id="offline-max-size"
          className="w-20"
          type="number"
          min={1}
          max={100}
          step={1}
          value={maxFileSizeMb}
          disabled={!contentSyncEnabled}
          onChange={(event) => {
            const parsed = Number.parseInt(event.target.value, 10);
            if (Number.isNaN(parsed)) return;
            persist({ maxFileSizeMb: Math.min(100, Math.max(1, parsed)) });
          }}
        />
      </FieldLabelRow>
    </SettingsPaneCard>
  );
}
