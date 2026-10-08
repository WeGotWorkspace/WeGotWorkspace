import {
  meetRelayCopy,
  type MeetRelayCopy,
  type RelayCopyOutcome,
} from "@/meet-core/src/meet-relay-copy";
import type { PrincipalRole } from "@/lib/api/wgw/principal-role";

export type MeetRelayPresentation = {
  toast: string | null;
  banner: MeetRelayCopy | null;
  tile: { peerId: string; message: string } | null;
};

/**
 * One viewer, one role. An admin in the call gets the banner (and Set up, on
 * a self-hosted `relay_unavailable`). Everyone else gets the affected-user
 * sentence, plus the tile sentence when the failure names another person.
 */
export function presentMeetRelayOutcome(input: {
  role: PrincipalRole;
  selfId: string | null;
  remoteId: string;
  name: string;
  outcome: RelayCopyOutcome;
}): MeetRelayPresentation {
  if (input.role === "admin") {
    return {
      toast: null,
      banner: meetRelayCopy({
        audience: "admin",
        outcome: input.outcome,
        name: input.name,
      }),
      tile: null,
    };
  }
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
    toast: affected?.message ?? null,
    banner: null,
    tile: participant ? { peerId: input.remoteId, message: participant.message } : null,
  };
}
