import { MonitorUp } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { meetLabels } from "@/meet-core/src/meet-labels";

type MeetScreenShareControlProps = {
  screenOn: boolean;
  onStart: () => void;
  onStop: () => void;
};

/**
 * One button: a click starts the share, the next click stops it. There is no
 * optimize choice; the screen track is always optimized for detail.
 */
export function MeetScreenShareControl({ screenOn, onStart, onStop }: MeetScreenShareControlProps) {
  return (
    <IconButton
      icon={<MonitorUp />}
      label={screenOn ? meetLabels.stopSharing : meetLabels.shareScreen}
      size="lg"
      variant="outline"
      active={screenOn}
      aria-pressed={screenOn}
      onClick={screenOn ? onStop : onStart}
    />
  );
}
