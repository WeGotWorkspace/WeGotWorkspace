import { describe, expect, it, vi } from "vitest";
import {
  handlePushSubscriptionChange,
  serviceWorkerApiBaseUrl,
  type PushSubscriptionChangeDeps,
} from "./push-subscription-change";

const SERVER_KEY = "AQID"; // bytes 1, 2, 3

type Call = {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
  credentials?: string;
  signal?: AbortSignal | null;
};

function fakeSubscription(endpoint: string, keyBytes: number[] | null) {
  return {
    endpoint,
    options: {
      applicationServerKey: keyBytes === null ? null : new Uint8Array(keyBytes).buffer,
      userVisibleOnly: true,
    },
    toJSON: () => ({ endpoint, keys: { p256dh: `p256-${endpoint}`, auth: `auth-${endpoint}` } }),
    unsubscribe: vi.fn(async () => true),
  } as unknown as PushSubscription & { unsubscribe: ReturnType<typeof vi.fn> };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Routes = Partial<Record<string, (init: RequestInit) => Response | Promise<Response>>>;

function setup(routes: Routes = {}, opts: { locks?: boolean; timeoutMs?: number } = {}) {
  const calls: Call[] = [];
  const defaults: Routes = {
    "POST /api/v1/auth/refresh": () => json(200, { access_token: "fresh-jwt", expires_in: 900 }),
    "GET /api/v1/notifications/push/vapid-public-key": () => json(200, { publicKey: SERVER_KEY }),
    "POST /api/v1/notifications/push/subscriptions": () => json(201, {}),
    "DELETE /api/v1/notifications/push/subscriptions": () => new Response(null, { status: 204 }),
  };
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    const method = headers.get("X-HTTP-Method-Override") ?? init.method ?? "GET";
    const url = String(input);
    calls.push({
      url,
      method,
      headers,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      credentials: init.credentials,
      signal: init.signal,
    });
    const route = { ...defaults, ...routes }[`${method} ${url}`];
    if (!route) throw new Error(`unexpected ${method} ${url}`);
    return route(init);
  });
  const created = fakeSubscription("https://push.example/created", [1, 2, 3]);
  const pushManager = {
    getSubscription: vi.fn(async () => null as PushSubscription | null),
    subscribe: vi.fn(async (_options?: PushSubscriptionOptionsInit) => created as PushSubscription),
  };
  const lockNames: string[] = [];
  const lockState = { held: false };
  const locks = {
    request: vi.fn(async (name: string, _options: LockOptions, cb: () => Promise<unknown>) => {
      lockNames.push(name);
      lockState.held = true;
      try {
        return await cb();
      } finally {
        lockState.held = false;
      }
    }),
  } as unknown as Pick<LockManager, "request">;
  const deps: PushSubscriptionChangeDeps = {
    apiBaseUrl: "/api/v1",
    fetch: fetchImpl as unknown as typeof fetch,
    pushManager,
    locks: opts.locks === false ? null : locks,
    timeoutMs: opts.timeoutMs,
  };
  return { deps, calls, pushManager, created, lockNames, lockState };
}

const callKeys = (calls: Call[]) => calls.map((c) => `${c.method} ${c.url}`);

describe("handlePushSubscriptionChange", () => {
  it("posts the browser's new subscription and removes the old endpoint", async () => {
    const { deps, calls, pushManager, lockNames } = setup();
    const oldSub = fakeSubscription("https://push.example/old", [1, 2, 3]);
    const newSub = fakeSubscription("https://push.example/new", [1, 2, 3]);

    await expect(
      handlePushSubscriptionChange({ oldSubscription: oldSub, newSubscription: newSub }, deps),
    ).resolves.toBe("resubscribed");

    expect(callKeys(calls)).toEqual([
      "POST /api/v1/auth/refresh",
      "GET /api/v1/notifications/push/vapid-public-key",
      "POST /api/v1/notifications/push/subscriptions",
      "DELETE /api/v1/notifications/push/subscriptions",
    ]);
    expect(lockNames).toEqual(["wgw-auth-refresh"]);
    expect(calls[0]?.credentials).toBe("same-origin");
    expect(calls[0]?.headers.get("Authorization")).toBeNull();
    for (const call of calls.slice(1)) {
      expect(call.headers.get("Authorization")).toBe("Bearer fresh-jwt");
    }
    expect(calls[2]?.body).toEqual({
      endpoint: "https://push.example/new",
      keys: { p256dh: "p256-https://push.example/new", auth: "auth-https://push.example/new" },
    });
    // DELETE rides POST + method override, like wgwFetch.
    expect(calls[3]?.headers.get("X-HTTP-Method-Override")).toBe("DELETE");
    expect(calls[3]?.body).toEqual({ endpoint: "https://push.example/old" });
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("subscribes with the current server key when the browser gave no new subscription", async () => {
    const { deps, calls, pushManager } = setup();
    const oldSub = fakeSubscription("https://push.example/old", [1, 2, 3]);

    await expect(
      handlePushSubscriptionChange({ oldSubscription: oldSub, newSubscription: null }, deps),
    ).resolves.toBe("resubscribed");

    expect(pushManager.getSubscription).toHaveBeenCalled();
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    const options = pushManager.subscribe.mock.calls[0]?.[0] ?? {};
    expect(options.userVisibleOnly).toBe(true);
    expect(Array.from(options.applicationServerKey as Uint8Array)).toEqual([1, 2, 3]);
    expect(calls[2]?.body).toMatchObject({ endpoint: "https://push.example/created" });
    expect(calls[3]?.body).toEqual({ endpoint: "https://push.example/old" });
  });

  it("replaces a new subscription that still uses an old VAPID key", async () => {
    const { deps, calls, pushManager } = setup();
    const stale = fakeSubscription("https://push.example/stale-key", [4, 5, 6]); // not SERVER_KEY

    await expect(
      handlePushSubscriptionChange({ oldSubscription: null, newSubscription: stale }, deps),
    ).resolves.toBe("resubscribed");

    expect(stale.unsubscribe).toHaveBeenCalledTimes(1);
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(calls[2]?.body).toMatchObject({ endpoint: "https://push.example/created" });
    // No old subscription in the event: nothing to remove.
    expect(callKeys(calls)).not.toContain("DELETE /api/v1/notifications/push/subscriptions");
  });

  it("reuses an existing browser subscription with the current key", async () => {
    const { deps, calls, pushManager } = setup();
    const existing = fakeSubscription("https://push.example/existing", [1, 2, 3]);
    pushManager.getSubscription.mockResolvedValue(existing);

    await expect(
      handlePushSubscriptionChange({ oldSubscription: null, newSubscription: null }, deps),
    ).resolves.toBe("resubscribed");

    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(calls[2]?.body).toMatchObject({ endpoint: "https://push.example/existing" });
  });

  it("stops without touching the browser when the refresh cookie is refused", async () => {
    const { deps, calls, pushManager } = setup({
      "POST /api/v1/auth/refresh": () => json(401, { error: "Invalid refresh token." }),
    });

    await expect(
      handlePushSubscriptionChange(
        {
          oldSubscription: fakeSubscription("https://push.example/old", null),
          newSubscription: null,
        },
        deps,
      ),
    ).resolves.toBe("no-session");

    expect(callKeys(calls)).toEqual(["POST /api/v1/auth/refresh"]);
    expect(pushManager.getSubscription).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("reports failure when the worker is offline", async () => {
    const { deps } = setup({
      "POST /api/v1/auth/refresh": () => {
        throw new TypeError("Failed to fetch");
      },
    });

    await expect(
      handlePushSubscriptionChange({ oldSubscription: null, newSubscription: null }, deps),
    ).resolves.toBe("failed");
  });

  it("keeps the old row when posting the new endpoint fails", async () => {
    const { deps, calls } = setup({
      "POST /api/v1/notifications/push/subscriptions": () => json(500, {}),
    });
    const oldSub = fakeSubscription("https://push.example/old", [1, 2, 3]);
    const newSub = fakeSubscription("https://push.example/new", [1, 2, 3]);

    await expect(
      handlePushSubscriptionChange({ oldSubscription: oldSub, newSubscription: newSub }, deps),
    ).resolves.toBe("failed");
    expect(callKeys(calls)).not.toContain("DELETE /api/v1/notifications/push/subscriptions");
  });

  it("still succeeds when removing the old endpoint fails", async () => {
    const { deps } = setup({
      "DELETE /api/v1/notifications/push/subscriptions": () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const oldSub = fakeSubscription("https://push.example/old", [1, 2, 3]);
    const newSub = fakeSubscription("https://push.example/new", [1, 2, 3]);

    await expect(
      handlePushSubscriptionChange({ oldSubscription: oldSub, newSubscription: newSub }, deps),
    ).resolves.toBe("resubscribed");
  });

  it("does not delete when the endpoint did not change", async () => {
    const { deps, calls } = setup();
    const same = fakeSubscription("https://push.example/same", [1, 2, 3]);

    await expect(
      handlePushSubscriptionChange({ oldSubscription: same, newSubscription: same }, deps),
    ).resolves.toBe("resubscribed");
    expect(callKeys(calls)).not.toContain("DELETE /api/v1/notifications/push/subscriptions");
  });

  it("refreshes without a lock when the browser has no Web Locks", async () => {
    const { deps, calls } = setup({}, { locks: false });

    await expect(
      handlePushSubscriptionChange({ oldSubscription: null, newSubscription: null }, deps),
    ).resolves.toBe("resubscribed");
    expect(calls[0]?.url).toBe("/api/v1/auth/refresh");
  });

  it("bounds every worker request with an abort signal", async () => {
    const { deps, calls } = setup();
    const oldSub = fakeSubscription("https://push.example/old", [1, 2, 3]);

    await handlePushSubscriptionChange({ oldSubscription: oldSub, newSubscription: null }, deps);

    expect(calls).toHaveLength(4);
    for (const call of calls) {
      expect(call.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("gives up on a hung refresh and releases the shared lock", async () => {
    const hungRefresh = (init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    const { deps, calls, pushManager, lockState } = setup(
      { "POST /api/v1/auth/refresh": hungRefresh },
      { timeoutMs: 20 },
    );

    await expect(
      handlePushSubscriptionChange({ oldSubscription: null, newSubscription: null }, deps),
    ).resolves.toBe("failed");

    expect(lockState.held).toBe(false);
    expect(callKeys(calls)).toEqual(["POST /api/v1/auth/refresh"]);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("fails when the server has no VAPID key", async () => {
    const { deps, pushManager } = setup({
      "GET /api/v1/notifications/push/vapid-public-key": () => json(200, { publicKey: "" }),
    });

    await expect(
      handlePushSubscriptionChange({ oldSubscription: null, newSubscription: null }, deps),
    ).resolves.toBe("failed");
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });
});

describe("serviceWorkerApiBaseUrl", () => {
  it("matches the window default and strips a trailing slash", () => {
    expect(serviceWorkerApiBaseUrl(undefined)).toBe("/api/v1");
    expect(serviceWorkerApiBaseUrl("  ")).toBe("/api/v1");
    expect(serviceWorkerApiBaseUrl("https://api.example/api/v1/")).toBe(
      "https://api.example/api/v1",
    );
  });
});
