import type { HttpSignalingPollResult } from "@/lib/rtc/signaling/http-client";

/**
 * A send response is `{ok: true}` plus, when the server has any, the same
 * `peers` / `messages` / `rosterSig` a poll would return. Clients that only
 * read `ok` ignore the rest.
 */
export function piggybackPoll(response: unknown): HttpSignalingPollResult | null {
  if (!response || typeof response !== "object") return null;
  const row = response as Record<string, unknown>;
  if (row.ok !== true) return null;
  if (!Array.isArray(row.peers) || !Array.isArray(row.messages)) return null;
  return {
    peers: row.peers as HttpSignalingPollResult["peers"],
    messages: row.messages as HttpSignalingPollResult["messages"],
    rosterSig: typeof row.rosterSig === "string" ? row.rosterSig : undefined,
  };
}
