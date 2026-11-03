// Shared by the live sync matrices (Notes, Tasks): users, API calls as a
// user, a signed-in browser context per user, and per-tab offline.
import type { Browser, BrowserContext, CDPSession, Page } from "@playwright/test";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const APP = process.env.WGW_APPS_E2E_BASE_URL ?? "http://127.0.0.1:5173";

export const OWNER = process.env.WGW_E2E_USERNAME ?? "admin";
export const TEAMMATE = process.env.WGW_E2E_TEAMMATE ?? "member";
const PASSWORDS: Record<string, string> = {
  [OWNER]: process.env.WGW_E2E_PASSWORD ?? "storybook-dev",
  [TEAMMATE]:
    process.env.WGW_E2E_TEAMMATE_PASSWORD ?? process.env.WGW_E2E_PASSWORD ?? "storybook-dev",
};

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- API ----------------------------------------------------------------------------------------

type Login = { accessToken: string; refreshCookie: string | null; at: number };
const logins = new Map<string, Login>();

async function login(user: string): Promise<Login> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const res = await fetch(`${API}/api/v1/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user, password: PASSWORDS[user] }),
    });
    if (res.status === 429) {
      await sleep(10_000);
      continue;
    }
    if (!res.ok) throw new Error(`Login ${user} failed: ${res.status} ${await res.text()}`);
    const tokens = (await res.json()) as { access_token: string };
    const cookie = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("wgw_refresh="));
    return {
      accessToken: tokens.access_token,
      refreshCookie: cookie ? cookie.split(";")[0]!.slice("wgw_refresh=".length) : null,
      at: Date.now(),
    };
  }
  throw new Error(`Login ${user} kept hitting the rate limit`);
}

/** A cached token for API calls from the test (not for a browser, which needs its own login). */
async function token(user: string): Promise<string> {
  const hit = logins.get(user);
  if (hit && Date.now() - hit.at < 300_000) return hit.accessToken;
  const fresh = await login(user);
  logins.set(user, fresh);
  return fresh.accessToken;
}

export async function api(
  user: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: unknown }> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const res = await fetch(`${API}/api/v1${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${await token(user)}`,
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429) {
      await sleep(10_000);
      continue;
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json };
  }
  throw new Error(`${method} ${path} kept hitting the rate limit`);
}

// --- browser ------------------------------------------------------------------------------------

export type Tab = Page & { tag: string; user: string; cdp?: CDPSession };

/** One isolated browser context (own IndexedDB) signed in as `user`. */
export async function openUser(browser: Browser, user: string): Promise<BrowserContext> {
  const { accessToken, refreshCookie } = await login(user);
  const context = await browser.newContext({
    baseURL: APP,
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1400, height: 900 },
  });
  if (refreshCookie) {
    const app = new URL(APP);
    await context.addCookies([
      {
        name: "wgw_refresh",
        value: refreshCookie,
        domain: app.hostname,
        path: "/api/v1/auth",
        httpOnly: true,
        sameSite: "Strict",
      },
    ]);
  }
  await context.addInitScript(
    ({ access }) => {
      localStorage.setItem("wgw.api.access_token", access);
      localStorage.setItem("wgw.api.session_kind", "member");
    },
    { access: accessToken },
  );
  return context;
}

/** DevTools "Offline" for this tab only. */
export async function setTabOffline(tab: Tab, offline: boolean): Promise<void> {
  if (!tab.cdp) {
    tab.cdp = await tab.context().newCDPSession(tab);
    await tab.cdp.send("Network.enable");
  }
  await tab.cdp.send("Network.emulateNetworkConditions", {
    offline,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await tab
    .evaluate((off) => window.dispatchEvent(new Event(off ? "offline" : "online")), offline)
    .catch(() => undefined);
}
