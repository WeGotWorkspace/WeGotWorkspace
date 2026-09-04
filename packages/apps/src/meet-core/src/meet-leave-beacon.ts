export type MeetLeaveBeaconInput = {
  roomCode: string;
  peerId: string;
  sessionKey?: string | null;
};

/** Best-effort keepalive DELETE so the roster drops this peer on tab close/navigation. */
export function sendMeetLeaveBeacon({ roomCode, peerId, sessionKey }: MeetLeaveBeaconInput): void {
  const payload = JSON.stringify({
    room: roomCode,
    peerId,
    sessionKey: sessionKey ?? undefined,
  });
  const endpoint = `/api/v1/rooms/${encodeURIComponent(roomCode)}/participants/${encodeURIComponent(peerId)}`;
  void fetch(endpoint, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => {
    // Ignore best-effort unload failures.
  });
}
