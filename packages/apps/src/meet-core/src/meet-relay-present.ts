import { meetRelayCopy, type RelayCopyOutcome } from "@/meet-core/src/meet-relay-copy";

export type MeetRelayPresentation = {
  toast: string | null;
  tile: { peerId: string; message: string } | null;
};

/**
 * One viewer. The person whose network blocked the path gets the toast.
 * Everyone else gets the tile when the failure names another person.
 */
export function presentMeetRelayOutcome(input: {
  selfId: string | null;
  remoteId: string;
  name: string;
  outcome: RelayCopyOutcome;
}): MeetRelayPresentation {
  const affected = meetRelayCopy({
    audience: "affected",
    outcome: input.outcome,
    name: input.name,
  });
  const aboutRemote = input.selfId !== null && input.remoteId !== input.selfId;
  const participant = aboutRemote
    ? meetRelayCopy({ audience: "participant", outcome: input.outcome, name: input.name })
    : null;
  return {
    toast: affected,
    tile: participant ? { peerId: input.remoteId, message: participant } : null,
  };
}
