import { fetchVapidPublicKey, subscribePush, unsubscribePush } from "@/lib/api/wgw/notifications";
import { withCrossTabLock } from "@/lib/offline/core/cross-tab-lock";
import {
  currentPushAccount,
  isPushSubscribedByOtherAccount,
  recordPushSubscriber,
} from "@/notifications-core/src/push-subscriber";

let permissionPrompt: Promise<NotificationPermission> | null = null;

const PUSH_SUBSCRIBE_LOCK = "wgw-push-subscribe";
/**
 * A hung subscribe() (Safari outside a user gesture) must not block later
 * retries forever: it bounds both the wait for the lock and a run holding it.
 */
const PUSH_SUBSCRIBE_MAX_WAIT_MS = 15_000;
/** Id of the run allowed to touch the push subscription; 0 once a run timed out. */
let activeRun = 0;
/** Only ever grows, so a timed-out run's id is never handed to a later run. */
let runCounter = 0;
let inTabRun: Promise<unknown> = Promise.resolve();

export function shouldRequestNotificationPermission(permission: string): boolean {
  return permission === "default";
}

/** Test-only: allow Vitest to re-prompt after stubbing Notification. */
export function resetEnsurePushSubscriptionForTests(): void {
  permissionPrompt = null;
  inTabRun = Promise.resolve();
  activeRun = 0;
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
async function dropStaleSubscription(
  subscription: PushSubscription,
  isCurrent: () => boolean,
): Promise<void> {
  await unsubscribePush(subscription.endpoint);
  if (!isCurrent()) return;
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
    withCrossTabLock(PUSH_SUBSCRIBE_LOCK, subscribeWithinLimit, {
      maxWaitMs: PUSH_SUBSCRIBE_MAX_WAIT_MS,
    }),
  );
  inTabRun = run.catch(() => undefined);
  return run;
}

/**
 * Run the subscribe work, but give up after the limit so a hung subscribe()
 * releases the Web Lock and the in-tab queue. The abandoned run cannot be
 * cancelled; it checks `isCurrent` after each await and stops touching the
 * subscription once it timed out or a newer run started.
 */
async function subscribeWithinLimit(): Promise<boolean> {
  runCounter += 1;
  const id = runCounter;
  activeRun = id;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      if (activeRun === id) activeRun = 0;
      resolve(false);
    }, PUSH_SUBSCRIBE_MAX_WAIT_MS);
  });
  try {
    return await Promise.race([subscribePushManager(() => activeRun === id), limit]);
  } finally {
    clearTimeout(timer);
  }
}

async function subscribePushManager(isCurrent: () => boolean): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const key = urlBase64ToUint8Array(await fetchVapidPublicKey());
  if (!isCurrent()) return false;
  const registration = await navigator.serviceWorker.ready;
  if (!isCurrent()) return false;
  // Safari often already has a PushSubscription after permission; subscribe()
  // then throws and used to be swallowed, so VAPID never got an endpoint row.
  // Reuse it unless it was made with another VAPID key: the push service then
  // rejects every send (403), so swap it for one on the current key.
  // Each account on a shared browser gets its own endpoint. Sign-out drops the
  // subscription, but a session that ends without it (refresh expiry) leaves
  // the previous account's subscription and server row behind. Replace it: the
  // old endpoint is then dead, and the server prunes that row once the push
  // service rejects it. Without a record the subscription is kept as-is.
  const account = currentPushAccount();
  let existing = await registration.pushManager.getSubscription();
  if (!isCurrent()) return false;
  if (existing && isSignedForOtherKey(existing, key)) {
    await dropStaleSubscription(existing, isCurrent);
    if (!isCurrent()) return false;
    existing = null;
  } else if (existing && isPushSubscribedByOtherAccount(account)) {
    await existing.unsubscribe();
    if (!isCurrent()) return false;
    existing = null;
  }
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key as BufferSource,
    }));
  if (!isCurrent()) return false;
  await subscribePush(subscription.toJSON());
  recordPushSubscriber(account);
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
