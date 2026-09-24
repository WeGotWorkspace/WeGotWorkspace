import { fetchVapidPublicKey, subscribePush } from "@/lib/api/wgw/notifications";

let permissionPrompt: Promise<NotificationPermission> | null = null;

export function shouldRequestNotificationPermission(permission: string): boolean {
  return permission === "default";
}

/** Test-only: allow Vitest to re-prompt after stubbing Notification. */
export function resetEnsurePushSubscriptionForTests(): void {
  permissionPrompt = null;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

async function currentPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  if (!shouldRequestNotificationPermission(Notification.permission)) {
    return Notification.permission;
  }
  if (!permissionPrompt) {
    permissionPrompt = Notification.requestPermission();
  }
  return permissionPrompt;
}

async function subscribePushManager(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const key = await fetchVapidPublicKey();
  const registration = await navigator.serviceWorker.ready;
  // Safari often already has a PushSubscription after permission; subscribe()
  // then throws and used to be swallowed, so VAPID never got an endpoint row.
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    }));
  await subscribePush(subscription.toJSON());
  return true;
}

/**
 * Prompt once while permission is still `default`, then subscribe so VAPID
 * sweep has a `push_subscriptions` row. Denied stays denied — no re-prompt.
 * Returns false when permission is missing or PushManager subscribe/POST fails.
 */
export async function ensurePushPermissionAndSubscribe(): Promise<boolean> {
  const permission = await currentPermission();
  if (permission !== "granted") return false;
  try {
    return await subscribePushManager();
  } catch {
    return false;
  }
}
