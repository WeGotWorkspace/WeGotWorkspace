import { adminPathFor } from "@/admin-core/src/admin-section";
import type { PrincipalRole } from "@/lib/api/wgw/principal-role";
import type { RelayRequestOutcome } from "@/lib/rtc/session/relay-request";

export type DocsRelayCopy = {
  message: string;
  /** Present only when the viewer is an admin on a self-hosted install. */
  setupHref?: string;
  /** Neutral plan link. Only when relay is plan-gated. */
  planHref?: string;
};

/**
 * Docs admin banner. Non-admins never see Set up, and this copy never says a
 * person can't join. The document owner gets Set up only when they are also
 * an admin — the role check is the whole gate.
 */
export function docsRelayCopy(input: {
  role: PrincipalRole;
  outcome: RelayRequestOutcome["outcome"] | null;
  name: string;
  relayIncludedInService?: boolean;
  planHref?: string | null;
}): DocsRelayCopy | null {
  if (input.outcome !== "relay_unavailable") return null;
  if (input.role !== "admin") return null;
  if (input.relayIncludedInService) {
    return {
      message:
        "Direct connections aren't possible on this network; your plan's relay is used automatically.",
      ...(input.planHref ? { planHref: input.planHref } : {}),
    };
  }
  return {
    message: `Collaboration with ${input.name} runs via the server (slower). A TURN server makes it faster.`,
    setupHref: adminPathFor("collaboration"),
  };
}
