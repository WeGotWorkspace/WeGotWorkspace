import { Button } from "@/button/src/button";
import { meetCallLiveIcon } from "@/meet-core/src/meet-call-live-icon";
import type { MeetCallInvite } from "@/meet-core/src/meet-call-stage-layout";
import {
  meetCallBarMeta,
  meetCallBarRoster,
  meetCallBarShownCount,
} from "@/meet-core/src/meet-call-bar-roster";
import { meetLabels } from "@/meet-core/src/meet-labels";
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
  /** Join on the bar while a meeting is live and this user has not joined. Start never lives here. */
  invite?: MeetCallInvite | null;
  onInvite?: () => void;
  /** Meeting was started as Meet (Audio Only) — mark and Join use audio chrome. */
  audioOnly?: boolean;
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
  invite = null,
  onInvite,
  audioOnly = false,
  className,
}: MeetCallBarProps) {
  const LiveIcon = meetCallLiveIcon(audioOnly);
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
    <div className={cn("meet-call-bar", className)}>
      <div className="meet-call-bar__row">
        <div className="meet-call-bar__start">
          <span className="meet-call-bar__mark" aria-hidden>
            <LiveIcon className="meet-workspace__header-kind-icon" />
          </span>
          <div className="meet-call-bar__copy">
            <p className="meet-call-bar__title">{meetLabels.meetingStarted}</p>
            {meta ? <p className="meet-call-bar__meta">{meta}</p> : null}
          </div>
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
                        size="md"
                        color={avatarColorForUserId(person.id)}
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{person.name}</TooltipContent>
                </Tooltip>
              </li>
            ))}
          </ul>
        </div>
        {invite === "join" && onInvite ? (
          <div className="meet-call-bar__invite">
            <Button
              className="meet-call-bar__invite-button"
              label={meetLabels.join}
              icon={<LiveIcon />}
              size="md"
              variant="primary"
              onClick={onInvite}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
