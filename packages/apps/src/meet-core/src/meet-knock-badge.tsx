import { Hand } from "lucide-react";
import type { IconButtonSize } from "@/button/src/button";
import { IconButton } from "@/button/src/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { MeetCallKnockQueue } from "@/meet-core/src/meet-call-knock";
import { meetLabels } from "@/meet-core/src/meet-labels";

type MeetKnocker = { id: string; name: string };

export type MeetKnockBadgeProps = {
  knockers: readonly MeetKnocker[];
  onAdmit: (peerId: string) => void;
  onDeny: (peerId: string) => void;
  size?: IconButtonSize;
};

/**
 * Production host admit affordance: a Hand icon on the call action row with a
 * count badge. Opens a compact popover of admit/deny rows.
 */
export function MeetKnockBadge({ knockers, onAdmit, onDeny, size = "sm" }: MeetKnockBadgeProps) {
  if (knockers.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          icon={<Hand />}
          label={meetLabels.waitingToJoin(knockers.length)}
          variant="outline"
          size={size}
          className="meet-knock-badge"
          data-count={knockers.length}
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="meet-knock-badge__popover">
        <MeetCallKnockQueue knockers={knockers} onAdmit={onAdmit} onDeny={onDeny} />
      </PopoverContent>
    </Popover>
  );
}
