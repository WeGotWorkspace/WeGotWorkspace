import type { NetClass } from "@/lib/rtc/net-probe";
import type { TurnCredentials } from "@/lib/rtc/types";

/**
 * Just-in-time relay request. Meet and the Docs HTTP fallback (#1095) both
 * call this with the room, peer, target and reason — it does not read Meet
 * session state, so collab can pass its own signaling client unmodified.
 */

export type RelayReason = "precheck" | "timeout" | "failed" | "refresh";

export type RelayRequest = {
  roomId: string;
  peerId: string;
  /** Peer id in the roster, or `"*"` when `reason` is `precheck`. */
  target: string;
  reason: RelayReason;
  net?: NetClass;
};

export type RelayRequestClient = {
  postRelay(
    roomId: string,
    body: {
      peerId: string;
      target: string;
      reason: RelayReason;
      net?: NetClass;
    },
  ): Promise<{ turn: TurnCredentials }>;
};

export type RelayRequestOutcome =
  | { outcome: "issued"; turn: TurnCredentials }
  | { outcome: "relay_unavailable" }
  | { outcome: "relay_denied" }
  | { outcome: "error"; error: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

export async function requestRelay(
  client: RelayRequestClient,
  request: RelayRequest,
): Promise<RelayRequestOutcome> {
  try {
    const response = await client.postRelay(request.roomId, {
      peerId: request.peerId,
      target: request.target,
      reason: request.reason,
      ...(request.net ? { net: request.net } : {}),
    });
    return { outcome: "issued", turn: response.turn };
  } catch (error) {
    const message = errorText(error);
    if (message.includes("relay_unavailable")) return { outcome: "relay_unavailable" };
    if (message.includes("relay_denied")) return { outcome: "relay_denied" };
    return { outcome: "error", error: message || "relay_failed" };
  }
}
