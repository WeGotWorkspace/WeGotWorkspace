import { useEffect, useState } from "react";
import { Switch } from "@/ui/switch";
import { Label } from "@/ui/label";
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
      <div className="settings-offline-pane space-y-8 max-w-lg">
        <p className="text-sm text-muted-foreground">
          Folder and file names sync automatically for Drive and Docs. These settings control
          whether file contents are saved on this device for offline use.
        </p>

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="offline-content-sync">Make files available offline</Label>
            <p className="text-sm text-muted-foreground">
              Automatically save file contents up to the max size below.
            </p>
          </div>
          <Switch
            checked={contentSyncEnabled}
            onCheckedChange={(checked) => persist({ contentSyncEnabled: checked })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="offline-max-size">Max file size (MB)</Label>
          <Input
            id="offline-max-size"
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
          <p className="text-sm text-muted-foreground">
            Files larger than this limit are not synced automatically. You can pin them manually
            from Drive while online.
          </p>
        </div>
      </div>
    </SettingsPaneCard>
  );
}
