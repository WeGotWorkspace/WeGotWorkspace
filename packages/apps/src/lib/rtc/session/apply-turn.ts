import { toRtcConfig } from "@/lib/rtc/config";
import type { RtcSettings, TurnCredentials } from "@/lib/rtc/types";

/**
 * Put TURN on the peer connection that already exists. Chromium accepts
 * `setConfiguration` plus `restartIce` without constructing a new
 * `RTCPeerConnection`. The caller sends the fresh offer.
 */
export function applyTurnOnPeerConnection(
  pc: RTCPeerConnection,
  settings: RtcSettings,
  turn: TurnCredentials,
  iceCandidatePoolSize?: number,
): void {
  const config = toRtcConfig(settings, "direct", { turn, iceCandidatePoolSize });
  pc.setConfiguration(config);
  pc.restartIce();
}
