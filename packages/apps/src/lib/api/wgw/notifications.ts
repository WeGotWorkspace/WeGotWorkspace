import { WgwRequestError } from "@/lib/api/wgw/request-error";
import type { NotificationInboxList } from "@/lib/models/notifications-types";
import { wgwFetch, wgwReadJson } from "@/lib/api/wgw/http";

export async function listNotifications(opts?: {
  unread?: boolean;
  signal?: AbortSignal;
}): Promise<NotificationInboxList> {
  const query = opts?.unread ? "?unread=1" : "";
  const res = await wgwFetch(`/notifications${query}`, { signal: opts?.signal });
  if (!res.ok) throw new WgwRequestError(`GET /notifications failed (${res.status})`, res.status);
  return (await wgwReadJson(res)) as NotificationInboxList;
}

export async function ackNotification(id: string): Promise<void> {
  const res = await wgwFetch(`/notifications/${encodeURIComponent(id)}/ack`, { method: "POST" });
  if (!res.ok)
    throw new WgwRequestError(`POST /notifications/${id}/ack failed (${res.status})`, res.status);
}

/**
 * Tell the server a visible window (or a Meet call) showed these rows, so the
 * VAPID sweep skips push for them. At most 100 ids; ids that are not the
 * user's rows are ignored.
 */
export async function ackLocalNotifications(ids: readonly string[]): Promise<void> {
  const res = await wgwFetch("/notifications/local-ack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok)
    throw new WgwRequestError(`POST /notifications/local-ack failed (${res.status})`, res.status);
}

export async function fetchVapidPublicKey(): Promise<string> {
  const res = await wgwFetch("/notifications/push/vapid-public-key");
  if (!res.ok) throw new WgwRequestError(`GET vapid-public-key failed (${res.status})`, res.status);
  const json = (await wgwReadJson(res)) as { publicKey?: string };
  return json.publicKey ?? "";
}

/**
 * `scope` is the installed app's manifest id, or `/` (see `push-scope.ts`).
 * Null leaves it out: the server then keeps the scopes it has.
 */
export async function subscribePush(
  subscription: PushSubscriptionJSON,
  scope: string | null,
): Promise<void> {
  const res = await wgwFetch("/notifications/push/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys?.p256dh,
        auth: subscription.keys?.auth,
      },
      ...(scope === null ? {} : { scope }),
    }),
  });
  if (!res.ok)
    throw new WgwRequestError(`POST push subscription failed (${res.status})`, res.status);
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  const res = await wgwFetch("/notifications/push/subscriptions", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  if (!res.ok)
    throw new WgwRequestError(`DELETE push subscription failed (${res.status})`, res.status);
}
