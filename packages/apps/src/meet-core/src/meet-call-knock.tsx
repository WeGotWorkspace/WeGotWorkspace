import { Hand } from "lucide-react";
import { Button } from "@/button/src/button";
import { Separator } from "@/ui/separator";
import { UserAvatar, avatarColorForUserId } from "@/user-avatar/src/user-avatar";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { cn } from "@/lib/utils";

export type MeetCallKnocker = { id: string; name: string };

export type MeetCallKnockQueueProps = {
  knockers: readonly MeetCallKnocker[];
  onAdmit: (peerId: string) => void;
  onDeny: (peerId: string) => void;
  className?: string;
};

/**
 * Host admit banner. Visible whenever someone is waiting; not behind a menu.
 */
export function MeetCallKnockQueue({
  knockers,
  onAdmit,
  onDeny,
  className,
}: MeetCallKnockQueueProps) {
  if (knockers.length === 0) return null;
  return (
    <section
      className={cn("meet-lobby-banner", className)}
      aria-label={meetLabels.lobbyWaiting(knockers.length)}
    >
      <header className="meet-lobby-banner__header">
        <h3 className="meet-lobby-banner__title">{meetLabels.lobbyWaiting(knockers.length)}</h3>
        <Button
          variant="primary"
          size="sm"
          label={meetLabels.admitAll}
          onClick={() => {
            for (const knocker of knockers) onAdmit(knocker.id);
          }}
        />
      </header>
      <Separator />
      <ul className="meet-lobby-banner__list">
        {knockers.map((knocker) => (
          <li key={knocker.id} className="meet-lobby-banner__row">
            <UserAvatar
              displayName={knocker.name}
              compact
              size="md"
              color={avatarColorForUserId(knocker.id)}
            />
            <div className="meet-lobby-banner__copy">
              <p className="meet-lobby-banner__name">
                {meetLabels.knockerWantsToJoin(knocker.name)}
              </p>
              <p className="meet-lobby-banner__hint">{meetLabels.waitingInLobby}</p>
            </div>
            <div className="meet-lobby-banner__actions">
              <Button
                variant="outline"
                size="sm"
                aria-label={meetLabels.denyName(knocker.name)}
                onClick={() => onDeny(knocker.id)}
              >
                {meetLabels.deny}
              </Button>
              <Button
                variant="primary"
                size="sm"
                aria-label={meetLabels.admitName(knocker.name)}
                onClick={() => onAdmit(knocker.id)}
              >
                {meetLabels.admit}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export type MeetCallKnockWaitingProps = {
  /** Channel title shown in the copy (e.g. `#general`). */
  channelTitle?: string;
  onCancel?: () => void;
  /** `bar` = compact banner above the chat column; `stage` = centered card. */
  variant?: "bar" | "stage";
  className?: string;
};

/**
 * Knocker-side wait state (chunk I): shown after `startCall` fell back to the
 * knock path (`requestJoin`) while the poll handler waits for a member's
 * admit (rename-rejoin, same peer id) or deny. Announced politely.
 */
export function MeetCallKnockWaiting({
  channelTitle,
  onCancel,
  variant = "bar",
  className,
}: MeetCallKnockWaitingProps) {
  return (
    <div
      className={cn(
        "meet-call-knock-wait",
        variant === "stage" && "meet-call-knock-wait--stage",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <span className="meet-call-knock-wait__icon" aria-hidden>
        <Hand className="size-4" />
      </span>
      <div className="meet-call-knock-wait__copy">
        <p className="meet-call-knock-wait__title">
          {channelTitle ? meetLabels.knockWaitTitle(channelTitle) : meetLabels.knocking}
        </p>
        <p className="meet-call-knock-wait__hint">{meetLabels.knockWaitHint}</p>
      </div>
      {onCancel ? (
        <Button
          label={meetLabels.cancelRequest}
          size="md"
          variant="outline"
          onClick={onCancel}
          className="meet-call-knock-wait__cancel"
        />
      ) : null}
    </div>
  );
}
