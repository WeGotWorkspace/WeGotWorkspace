import { MeetCallKnockQueue, type MeetCallKnocker } from "@/meet-core/src/meet-call-knock";

export type MeetKnockBadgeProps = {
  knockers: readonly MeetCallKnocker[];
  onAdmit: (peerId: string) => void;
  onDeny: (peerId: string) => void;
};

/** Visible lobby banner. Replaces the action-row popover. */
export function MeetKnockBadge({ knockers, onAdmit, onDeny }: MeetKnockBadgeProps) {
  return <MeetCallKnockQueue knockers={knockers} onAdmit={onAdmit} onDeny={onDeny} />;
}
