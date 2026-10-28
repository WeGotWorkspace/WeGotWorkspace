import { fetchVapidPublicKey, subscribePush, unsubscribePush } from "@/lib/api/wgw/notifications";
import { withCrossTabLock } from "@/lib/offline/core/cross-tab-lock";

let permissionPrompt: Promise<NotificationPermission> | null = null;

const PUSH_SUBSCRIBE_LOCK = "wgw-push-subscribe";
/** A hung subscribe() (Safari outside a user gesture) must not block later retries forever. */
const PUSH_SUBSCRIBE_MAX_WAIT_MS = 15_000;
let inTabRun: Promise<unknown> = Promise.resolve();

export function shouldRequestNotificationPermission(permission: string): boolean {
  return permission === "default";
}

/** Test-only: allow Vitest to re-prompt after stubbing Notification. */
export function resetEnsurePushSubscriptionForTests(): void {
  permissionPrompt = null;
  inTabRun = Promise.resolve();
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

/**
 * True only when the subscription was made with a different VAPID key.
 * A missing key on either side is unknown, so the subscription stays.
 */
function isSignedForOtherKey(subscription: PushSubscription, currentKey: Uint8Array): boolean {
  const stored = subscription.options?.applicationServerKey;
  if (!stored || currentKey.length === 0) return false;
  const storedBytes = new Uint8Array(stored);
  if (storedBytes.length !== currentKey.length) return true;
  return storedBytes.some((byte, i) => byte !== currentKey[i]);
}

/**
 * Remove the server row first: the DELETE always answers 204, so a failure
 * here is transient and the next app load retries with the old subscription
 * still in place.
 */
async function dropStaleSubscription(subscription: PushSubscription): Promise<void> {
  await unsubscribePush(subscription.endpoint);
  await subscription.unsubscribe();
}

/**
 * One subscribe run at a time, in this tab and across tabs. The app starts
 * several runs per load; two runs that both found a stale subscription each
 * replaced it, and the later unsubscribe could drop the earlier run's new
 * subscription, leaving the browser with none. A queued run re-reads the
 * subscription the previous one made and only posts it again.
 */
function subscribePushManagerOnce(): Promise<boolean> {
  const run = inTabRun.then(() =>
    withCrossTabLock(PUSH_SUBSCRIBE_LOCK, subscribePushManager, {
      maxWaitMs: PUSH_SUBSCRIBE_MAX_WAIT_MS,
    }),
  );
  inTabRun = run.catch(() => undefined);
  return run;
}

async function subscribePushManager(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const key = urlBase64ToUint8Array(await fetchVapidPublicKey());
  const registration = await navigator.serviceWorker.ready;
  // Safari often already has a PushSubscription after permission; subscribe()
  // then throws and used to be swallowed, so VAPID never got an endpoint row.
  // Reuse it unless it was made with another VAPID key: the push service then
  // rejects every send (403), so swap it for one on the current key.
  let existing = await registration.pushManager.getSubscription();
  if (existing && isSignedForOtherKey(existing, key)) {
    await dropStaleSubscription(existing);
    existing = null;
  }
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key as BufferSource,
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
    return await subscribePushManagerOnce();
  } catch {
    return false;
  }
}
