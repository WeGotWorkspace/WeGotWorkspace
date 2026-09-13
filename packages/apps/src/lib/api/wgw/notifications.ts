import type { NotificationInboxList } from "@/notifications-core/src/notifications-types";
import { wgwFetch, wgwReadJson } from "@/lib/api/wgw/http";

export async function listNotifications(opts?: {
  unread?: boolean;
  signal?: AbortSignal;
}): Promise<NotificationInboxList> {
  const query = opts?.unread ? "?unread=1" : "";
  const res = await wgwFetch(`/notifications${query}`, { signal: opts?.signal });
  if (!res.ok) throw new Error(`GET /notifications failed (${res.status})`);
  return (await wgwReadJson(res)) as NotificationInboxList;
}

export async function ackNotification(id: string): Promise<void> {
  const res = await wgwFetch(`/notifications/${encodeURIComponent(id)}/ack`, { method: "POST" });
  if (!res.ok) throw new Error(`POST /notifications/${id}/ack failed (${res.status})`);
}

export async function ackLocalNotification(id: string): Promise<void> {
  const res = await wgwFetch(`/notifications/${encodeURIComponent(id)}/local-ack`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`POST /notifications/${id}/local-ack failed (${res.status})`);
}

export async function fetchVapidPublicKey(): Promise<string> {
  const res = await wgwFetch("/notifications/push/vapid-public-key");
  if (!res.ok) throw new Error(`GET vapid-public-key failed (${res.status})`);
  const json = (await wgwReadJson(res)) as { publicKey?: string };
  return json.publicKey ?? "";
}

export async function subscribePush(subscription: PushSubscriptionJSON): Promise<void> {
  const res = await wgwFetch("/notifications/push/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys?.p256dh,
        auth: subscription.keys?.auth,
      },
    }),
  });
  if (!res.ok) throw new Error(`POST push subscription failed (${res.status})`);
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  const res = await wgwFetch("/notifications/push/subscriptions", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  if (!res.ok) throw new Error(`DELETE push subscription failed (${res.status})`);
}
