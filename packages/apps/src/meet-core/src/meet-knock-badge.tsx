import { Check, Hand, X } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import { meetLabels } from "@/meet-core/src/meet-labels";

type MeetKnocker = { id: string; name: string };

type MeetKnockBadgeProps = {
  knockers: MeetKnocker[];
  onAdmit: (peerId: string) => void;
  onDeny: (peerId: string) => void;
};

export function MeetKnockBadge({ knockers, onAdmit, onDeny }: MeetKnockBadgeProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          icon={<Hand />}
          label={meetLabels.waitingToJoin(knockers.length)}
          variant="subtle"
          className="meet-knock-badge"
          data-count={knockers.length}
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="meet-popover-surface w-80 p-2">
        <div className="space-y-1">
          {knockers.map((knocker) => (
            <div key={knocker.id} className="meet-knock-row">
              <UserAvatar displayName={knocker.name} compact size="sm" />
              <div className="flex-1">
                <div className="text-sm font-medium">{knocker.name}</div>
                <div className="text-[11px]" style={{ color: "var(--meet-muted)" }}>
                  {meetLabels.wantsToJoin}
                </div>
              </div>
              <IconButton
                onClick={() => onDeny(knocker.id)}
                icon={<X />}
                label={`Deny ${knocker.name}`}
                variant="subtle"
                size="sm"
                showTooltip={false}
                className="meet-knock-row__deny"
              />
              <IconButton
                onClick={() => onAdmit(knocker.id)}
                icon={<Check />}
                label={`Admit ${knocker.name}`}
                variant="primary"
                size="sm"
                showTooltip={false}
                className="meet-knock-row__admit"
              />
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
