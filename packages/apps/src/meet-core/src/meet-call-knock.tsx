import { Check, Hand, X } from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
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
 * Member-side knock notifications for the new Meet call chrome (chunk I): a
 * compact banner listing everyone waiting on the chunk-H knock path, with
 * per-knocker admit / deny. Reuses the `meet-knock-row` styling the legacy
 * `MeetKnockBadge` popover uses; admit / deny ride the same control-message
 * plumbing (`admitKnocker` / `denyKnocker` on the controller — the server
 * records the admission for the knocker's rename-rejoin).
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
      className={cn("meet-call-knock-queue", className)}
      role="alert"
      aria-label={meetLabels.waitingToJoin(knockers.length)}
    >
      {knockers.map((knocker) => (
        <div key={knocker.id} className="meet-knock-row">
          <UserAvatar displayName={knocker.name} compact size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{knocker.name}</div>
            <div className="text-[11px]" style={{ color: "var(--meet-muted)" }}>
              {meetLabels.wantsToJoin}
            </div>
          </div>
          <IconButton
            onClick={() => onDeny(knocker.id)}
            icon={<X />}
            label={meetLabels.denyName(knocker.name)}
            variant="subtle"
            size="sm"
            showTooltip={false}
            className="meet-knock-row__deny"
          />
          <IconButton
            onClick={() => onAdmit(knocker.id)}
            icon={<Check />}
            label={meetLabels.admitName(knocker.name)}
            variant="primary"
            size="sm"
            showTooltip={false}
            className="meet-knock-row__admit"
          />
        </div>
      ))}
    </section>
  );
}

export type MeetCallKnockWaitingProps = {
  /** Channel title shown in the copy (e.g. `#general`). */
  channelTitle?: string;
  onCancel?: () => void;
  /** `bar` = compact banner above the chat column; `stage` = centered card on the expanded stage. */
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
          size="sm"
          variant="subtle"
          onClick={onCancel}
          className="meet-call-knock-wait__cancel"
        />
      ) : null}
    </div>
  );
}
