import { AUTH_REFRESH_WEB_LOCK_NAME } from "@/lib/api/wgw/auth-refresh-lock";
import { tunnelMutatingHttpMethod } from "@/lib/api/wgw/http-method-tunnel";

/**
 * Service worker side of `pushsubscriptionchange` (#1604).
 *
 * The worker cannot read the window's access token (localStorage), but a
 * same-origin worker fetch carries the HttpOnly refresh cookie. So the worker
 * refreshes once under the same Web Lock the tabs use, then registers the new
 * endpoint and drops the old one with that access token.
 *
 * When refresh is refused or the network is down, nothing is stored: the next
 * signed-in window runs `ensurePushPermissionAndSubscribe()`, which subscribes
 * and posts the endpoint again. The server prunes the old endpoint on 404/410.
 */

export type PushSubscriptionChangeOutcome =
  /** New endpoint posted to the server. */
  | "resubscribed"
  /** Refresh cookie missing, expired or revoked; the next sign-in subscribes. */
  | "no-session"
  /** Network or server error; the next signed-in window subscribes. */
  | "failed";

export type PushSubscriptionChange = {
  oldSubscription: PushSubscription | null;
  newSubscription: PushSubscription | null;
};

export type PushSubscriptionChangeDeps = {
  /** API root including `/api/v1`, see {@link serviceWorkerApiBaseUrl}. */
  apiBaseUrl: string;
  fetch: typeof fetch;
  pushManager: Pick<PushManager, "getSubscription" | "subscribe">;
  /** `navigator.locks` in the worker; null when the browser has no Web Locks. */
  locks: Pick<LockManager, "request"> | null;
};

/** Same rule as `wgwApiBaseUrl()` without the Storybook runtime override. */
export function serviceWorkerApiBaseUrl(raw: string | undefined): string {
  const trimmed = raw?.trim();
  return (trimmed && trimmed.length > 0 ? trimmed : "/api/v1").replace(/\/$/, "");
}

export async function handlePushSubscriptionChange(
  change: PushSubscriptionChange,
  deps: PushSubscriptionChangeDeps,
): Promise<PushSubscriptionChangeOutcome> {
  try {
    const token = await refreshAccessToken(deps);
    if (token === null) return "no-session";

    const key = await fetchVapidPublicKey(token, deps);
    const subscription = await currentKeySubscription(change, key, deps.pushManager);
    const posted = await authedJson(token, deps, "/notifications/push/subscriptions", "POST", {
      endpoint: subscription.endpoint,
      keys: subscription.toJSON().keys ?? {},
    });
    if (!posted.ok) return "failed";

    await removeOldEndpoint(token, deps, change.oldSubscription, subscription.endpoint);
    return "resubscribed";
  } catch {
    return "failed";
  }
}

async function refreshAccessToken(deps: PushSubscriptionChangeDeps): Promise<string | null> {
  const run = async (): Promise<string | null> => {
    const res = await deps.fetch(`${deps.apiBaseUrl}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      credentials: "same-origin",
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) return null;
    if (!res.ok) throw new Error(`POST /auth/refresh failed (${res.status})`);
    const json = (await res.json()) as { access_token?: unknown };
    if (typeof json.access_token !== "string" || json.access_token === "") {
      throw new Error("Refresh response missing access_token");
    }
    return json.access_token;
  };
  if (!deps.locks) return run();
  return deps.locks
    .request(AUTH_REFRESH_WEB_LOCK_NAME, { mode: "exclusive" }, () => run())
    .then((value) => value);
}

async function fetchVapidPublicKey(
  token: string,
  deps: PushSubscriptionChangeDeps,
): Promise<string> {
  const res = await authedJson(token, deps, "/notifications/push/vapid-public-key", "GET");
  if (!res.ok) throw new Error(`GET vapid-public-key failed (${res.status})`);
  const json = (await res.json()) as { publicKey?: unknown };
  if (typeof json.publicKey !== "string" || json.publicKey === "") {
    throw new Error("VAPID public key missing");
  }
  return json.publicKey;
}

/**
 * Prefer the subscription the browser already made. If it was made with a key
 * the server no longer uses, pushes to it would fail: replace it.
 */
async function currentKeySubscription(
  change: PushSubscriptionChange,
  key: string,
  pushManager: PushSubscriptionChangeDeps["pushManager"],
): Promise<PushSubscription> {
  const serverKey = urlBase64ToUint8Array(key);
  const candidate = change.newSubscription ?? (await pushManager.getSubscription());
  if (candidate) {
    if (sameKey(candidate.options?.applicationServerKey ?? null, serverKey)) return candidate;
    await candidate.unsubscribe();
  }
  return pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: serverKey as BufferSource,
  });
}

async function removeOldEndpoint(
  token: string,
  deps: PushSubscriptionChangeDeps,
  old: PushSubscription | null,
  currentEndpoint: string,
): Promise<void> {
  if (!old?.endpoint || old.endpoint === currentEndpoint) return;
  try {
    await authedJson(token, deps, "/notifications/push/subscriptions", "DELETE", {
      endpoint: old.endpoint,
    });
  } catch {
    // The server also prunes an endpoint that answers 404/410.
  }
}

function authedJson(
  token: string,
  deps: PushSubscriptionChangeDeps,
  path: string,
  method: "GET" | "POST" | "DELETE",
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const init = tunnelMutatingHttpMethod({
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return deps.fetch(`${deps.apiBaseUrl}${path}`, init);
}

/** A subscription without a readable key is trusted; the browser made it for this worker. */
function sameKey(current: ArrayBuffer | null, serverKey: Uint8Array): boolean {
  if (current === null) return true;
  const bytes = new Uint8Array(current);
  if (bytes.length !== serverKey.length) return false;
  return bytes.every((byte, index) => byte === serverKey[index]);
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
