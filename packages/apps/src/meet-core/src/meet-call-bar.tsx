import {
  meetCallBarMeta,
  meetCallBarRoster,
  meetCallBarShownCount,
} from "@/meet-core/src/meet-call-bar-roster";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { ListStickyHeader } from "@/list-sticky-header/src/list-sticky-header";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { UserAvatar, avatarColorForUserId } from "@/user-avatar/src/user-avatar";
import { cn } from "@/lib/utils";

export type MeetCallBarPeer = {
  id: string;
  name: string;
  stream?: MediaStream | null;
  remoteMedia?: { camera: boolean; mic: boolean } | null;
  disclosedMedia?: { camera: boolean; mic: boolean; screen?: boolean } | null;
};

export type MeetCallBarProps = {
  elapsedLabel: string;
  selfId: string;
  selfName: string;
  selfStream?: MediaStream | null;
  peers: MeetCallBarPeer[];
  participantCount: number;
  /** Include this user in the roster and show elapsed time. Device controls live on the stage. */
  joined?: boolean;
  className?: string;
};

export {
  meetCallBarMeta,
  meetCallBarRoster,
  meetCallBarShownCount,
  meetCallPreviewPeers,
} from "@/meet-core/src/meet-call-bar-roster";

export function MeetCallBar({
  elapsedLabel,
  selfId,
  selfName,
  selfStream = null,
  peers,
  participantCount,
  joined = false,
  className,
}: MeetCallBarProps) {
  const roster = meetCallBarRoster({
    joined,
    self: { id: selfId, name: selfName, stream: selfStream },
    peers,
  });
  const meta = meetCallBarMeta(
    meetCallBarShownCount({ joined, participantCount, peerCount: peers.length }),
    joined ? elapsedLabel : undefined,
  );

  return (
    <ListStickyHeader
      variant="selection"
      className={cn("meet-call-bar", className)}
      label={meta ? `${meetLabels.meetingStarted} ${meta}` : meetLabels.meetingStarted}
      emphasis={meetLabels.meetingStarted}
      rest={meta}
      end={
        roster.length > 0 ? (
          <ul className="meet-call-bar__avatars">
            {roster.map((person) => (
              <li key={person.id}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <UserAvatar
                        displayName={person.name}
                        ariaLabel={person.name}
                        compact
                        size="xs"
                        color={avatarColorForUserId(person.id)}
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{person.name}</TooltipContent>
                </Tooltip>
              </li>
            ))}
          </ul>
        ) : null
      }
    />
  );
}
