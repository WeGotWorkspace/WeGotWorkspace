import { sendMeshCheckNow } from "@/lib/jmap-client/push/mesh-check-now";

/**
 * Response header in which the server names the users a write notified (an
 * inbox row was created, updated or cleared for them). Only on responses to
 * the writer's own request, never for another actor (#1662).
 */
export const WGW_NOTIFIED_HEADER = "X-Wgw-Notified";

/** Bounds what one response can make this tab send. */
const MAX_NOTIFIED_USERNAMES = 64;

export function notifiedUsernames(response: Response): string[] {
  if (!response.ok) return [];
  const raw = response.headers.get(WGW_NOTIFIED_HEADER);
  if (!raw) return [];
  const names = raw
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  return [...new Set(names)].slice(0, MAX_NOTIFIED_USERNAMES);
}

/** Active news: nudge exactly the users this write notified, so their inbox updates now. */
export function nudgeNotifiedUsers(response: Response): Response {
  sendMeshCheckNow(notifiedUsernames(response));
  return response;
}
