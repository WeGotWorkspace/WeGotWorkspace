import { adminPathFor } from "@/admin-core/src/admin-section";

/**
 * Same docs host the admin updates pane already links. The matrix is the TURN
 * setup note operators have.
 */
export const MEET_TURN_DOCS_URL =
  "https://github.com/WeGotWorkspace/wegotworkspace/blob/main/docs/testing/rtc-network-matrix.md";

export const MEET_RELAY_SETTINGS_PATH = adminPathFor("collaboration");

export type RelayCopyOutcome = "issued" | "relay_unavailable" | "relay_denied" | "error";

export type RelayCopyAudience = "affected" | "participant" | "admin";

export type MeetRelayCopy = {
  message: string;
  /** Present only for an admin on a self-hosted `relay_unavailable`. */
  setupHref?: string;
  docsHref?: string;
  /** Kept so an older banner can still read the field. Nothing sets it. */
  planHref?: string;
};

/**
 * One message per role. Non-admins never receive Set up.
 */
export function meetRelayCopy(input: {
  audience: RelayCopyAudience;
  outcome: RelayCopyOutcome | null;
  name: string;
}): MeetRelayCopy | null {
  if (!input.outcome) return null;
  if (input.audience === "affected") {
    if (input.outcome !== "relay_unavailable") return null;
    return {
      message:
        "Your network is blocking direct connections. Try another network, or ask your administrator.",
    };
  }
  if (input.audience === "participant") {
    if (input.outcome !== "relay_unavailable") return null;
    return { message: `Can't connect to ${input.name}` };
  }
  if (input.outcome !== "relay_unavailable") return null;
  return {
    message: `${input.name} can't join the call because of a firewall. A TURN server fixes this.`,
    setupHref: MEET_RELAY_SETTINGS_PATH,
    docsHref: MEET_TURN_DOCS_URL,
  };
}
