import { useEffect, useState } from "react";
import { Label } from "@/ui/label";
import { Switch } from "@/ui/switch";
import {
  readMeetLowData,
  subscribeMeetLowData,
  writeMeetLowData,
} from "@/meet-core/src/meet-low-data";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";

/** Device setting for Meet. Stored on this browser, not on the account. */
export function SettingsMeetPane() {
  const [lowData, setLowData] = useState(false);

  useEffect(() => {
    const apply = () => setLowData(readMeetLowData());
    apply();
    return subscribeMeetLowData(apply);
  }, []);

  return (
    <SettingsPaneCard>
      <div className="settings-meet-pane max-w-lg space-y-4">
        <p className="text-sm text-muted-foreground">{meetLabels.lowDataModeHint}</p>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="meet-low-data">{meetLabels.lowDataMode}</Label>
          <Switch
            id="meet-low-data"
            checked={lowData}
            onCheckedChange={(checked) => writeMeetLowData(checked)}
          />
        </div>
      </div>
    </SettingsPaneCard>
  );
}
