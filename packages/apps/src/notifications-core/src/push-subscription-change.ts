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
  /** Per-request limit; defaults to {@link WORKER_FETCH_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** How long a refresh with no response is retried; defaults to {@link REFRESH_GRACE_MS}. */
  refreshGraceMs?: number;
  /**
   * App scopes the pages posted (#1606, `readPushScopes`). The worker cannot
   * tell which app it serves, so it posts the new endpoint once per remembered scope.
   */
  readScopes: () => Promise<readonly string[]>;
};

/** Matches `RefreshTokenRepository::ROTATION_GRACE_SECONDS` on the server. */
export const REFRESH_GRACE_MS = 60_000;

/**
 * The refresh runs while holding the tabs' shared Web Lock. A hung request must
 * not stall every open tab's token refresh, so each worker fetch is bounded.
 */
export const WORKER_FETCH_TIMEOUT_MS = 10_000;

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
    if (!(await postSubscription(token, deps, subscription))) return "failed";

    await removeOldEndpoint(token, deps, change.oldSubscription, subscription.endpoint);
    return "resubscribed";
  } catch {
    return "failed";
  }
}

/**
 * One POST per remembered app scope. With none remembered (an endpoint made
 * before scopes, or storage that failed) the POST carries no scope, which the
 * server keeps as "unknown": it receives everything until a page posts one.
 */
async function postSubscription(
  token: string,
  deps: PushSubscriptionChangeDeps,
  subscription: PushSubscription,
): Promise<boolean> {
  const scopes = await deps.readScopes().catch(() => [] as readonly string[]);
  const body = { endpoint: subscription.endpoint, keys: subscription.toJSON().keys ?? {} };
  for (const scope of scopes.length > 0 ? scopes : [null]) {
    const posted = await authedJson(
      token,
      deps,
      "/notifications/push/subscriptions",
      "POST",
      scope === null ? body : { ...body, scope },
    );
    if (!posted.ok) return false;
  }
  return true;
}

/**
 * `POST /auth/refresh` rotates the cookie before the response is sent. If the
 * response never arrives, the browser keeps the old cookie and a later refresh
 * outside the server's grace window revokes the session. So an attempt that
 * throws (abort, network) or gets a 5xx is retried until a response arrives or
 * the grace budget is spent.
 */
async function refreshAccessToken(deps: PushSubscriptionChangeDeps): Promise<string | null> {
  const timeoutMs = deps.timeoutMs ?? WORKER_FETCH_TIMEOUT_MS;
  const graceMs = deps.refreshGraceMs ?? REFRESH_GRACE_MS;
  const started = Date.now();
  for (;;) {
    const attemptStarted = Date.now();
    const result = deps.locks
      ? await deps.locks.request(AUTH_REFRESH_WEB_LOCK_NAME, { mode: "exclusive" }, () =>
          refreshAttempt(deps),
        )
      : await refreshAttempt(deps);
    if (result !== RETRY) return result;

    const now = Date.now();
    const graceLeft = graceMs - (now - started);
    if (graceLeft <= 0)
      throw new Error("POST /auth/refresh got no response within the grace window");
    // Outside the lock: a hang frees it for tabs, and a fast failure cannot spin.
    await delay(Math.min(Math.max(timeoutMs - (now - attemptStarted), 0), graceLeft));
    if (Date.now() - started >= graceMs) {
      throw new Error("POST /auth/refresh got no response within the grace window");
    }
  }
}

const RETRY = Symbol("retry");

async function refreshAttempt(
  deps: PushSubscriptionChangeDeps,
): Promise<string | null | typeof RETRY> {
  let res: Response;
  try {
    res = await deps.fetch(`${deps.apiBaseUrl}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      credentials: "same-origin",
      signal: timeoutSignal(deps),
    });
  } catch {
    return RETRY;
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) return null;
  if (res.status >= 500) return RETRY;
  if (!res.ok) throw new Error(`POST /auth/refresh failed (${res.status})`);
  const json = (await res.json()) as { access_token?: unknown };
  if (typeof json.access_token !== "string" || json.access_token === "") {
    throw new Error("Refresh response missing access_token");
  }
  return json.access_token;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    signal: timeoutSignal(deps),
  });
  return deps.fetch(`${deps.apiBaseUrl}${path}`, init);
}

/** Aborts the request and its body read; the abort error ends the handler as `failed`. */
function timeoutSignal(deps: PushSubscriptionChangeDeps): AbortSignal {
  return AbortSignal.timeout(deps.timeoutMs ?? WORKER_FETCH_TIMEOUT_MS);
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
