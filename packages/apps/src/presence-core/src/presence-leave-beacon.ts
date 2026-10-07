import { wgwApiBaseUrl } from "@/lib/api/wgw/http";

export type PresenceLeaveBeaconInput = {
  roomId: string;
  peerId: string;
  bearerToken?: string | null;
};

/** Best-effort keepalive DELETE so a reload does not leave a principal ghost. */
export function sendPresenceLeaveBeacon({
  roomId,
  peerId,
  bearerToken,
}: PresenceLeaveBeaconInput): void {
  const endpoint = `${wgwApiBaseUrl()}/rooms/${encodeURIComponent(roomId)}/participants/${encodeURIComponent(peerId)}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  void fetch(endpoint, {
    method: "DELETE",
    headers,
    body: JSON.stringify({ peerId }),
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => {
    // Ignore best-effort unload failures.
  });
}
