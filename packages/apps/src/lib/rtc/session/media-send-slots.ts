/**
 * Every media link carries one audio and one video send slot, even when the
 * local stream lacks that kind (an audio-only join). Turning the camera or mic
 * on later fills the empty slot with `replaceTrack`, which needs no new offer.
 * Without a slot the track has nowhere to go, because the mesh only renegotiates
 * from the initiator side.
 */
const MEDIA_KINDS = ["audio", "video"] as const;

export type MediaKind = (typeof MEDIA_KINDS)[number];

function transceiversOf(pc: RTCPeerConnection): RTCRtpTransceiver[] {
  return typeof pc.getTransceivers === "function" ? pc.getTransceivers() : [];
}

function transceiverKind(transceiver: RTCRtpTransceiver): string | undefined {
  return transceiver.receiver?.track?.kind;
}

function sends(direction: RTCRtpTransceiverDirection): boolean {
  return direction === "sendrecv" || direction === "sendonly";
}

/** Initiator: add an empty send-receive slot for each kind the local stream lacks. */
export function reserveMediaSendSlots(pc: RTCPeerConnection, stream: MediaStream | null): void {
  if (typeof pc.addTransceiver !== "function") return;
  for (const kind of MEDIA_KINDS) {
    const hasTrack =
      kind === "audio"
        ? (stream?.getAudioTracks().length ?? 0) > 0
        : (stream?.getVideoTracks().length ?? 0) > 0;
    if (hasTrack) continue;
    pc.addTransceiver(kind, { direction: "sendrecv", streams: stream ? [stream] : [] });
  }
}

/**
 * Answerer, after the remote offer and before the answer: a slot the offer made
 * for a kind this side does not send yet comes in as `recvonly`. Answer it as
 * send-receive so a later track can be placed on it.
 */
export function openIdleMediaSendSlots(pc: RTCPeerConnection): void {
  for (const transceiver of transceiversOf(pc)) {
    const kind = transceiverKind(transceiver);
    if (kind !== "audio" && kind !== "video") continue;
    if (transceiver.direction !== "recvonly" || transceiver.sender.track) continue;
    transceiver.direction = "sendrecv";
  }
}

/** The sender that carries `kind`: the one with a track, else an empty send slot. */
export function mediaSenderFor(pc: RTCPeerConnection, kind: MediaKind): RTCRtpSender | null {
  const live = pc.getSenders().find((sender) => sender.track?.kind === kind);
  if (live) return live;
  const slot = transceiversOf(pc).find(
    (transceiver) =>
      transceiverKind(transceiver) === kind &&
      !transceiver.sender.track &&
      sends(transceiver.direction),
  );
  return slot?.sender ?? null;
}
