export type RelayCopyOutcome = "issued" | "relay_unavailable" | "relay_denied" | "error";

export type RelayCopyAudience = "affected" | "participant";

/**
 * In-call sentences for the person on this network, and for everyone else
 * looking at that person's tile. An admin in the call sees the same sentences.
 */
export function meetRelayCopy(input: {
  audience: RelayCopyAudience;
  outcome: RelayCopyOutcome | null;
  name: string;
}): string | null {
  if (input.outcome !== "relay_unavailable") return null;
  if (input.audience === "affected") {
    return "Your network is blocking direct connections. Try another network, or ask your administrator.";
  }
  return `Can't connect to ${input.name}`;
}
