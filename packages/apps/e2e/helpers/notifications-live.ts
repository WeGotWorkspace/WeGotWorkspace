import { expect, type Browser, type BrowserContext } from "@playwright/test";

/** Shared by the live notification specs: logins, DMs and the push stream. */
export const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
export const APP = process.env.WGW_APPS_E2E_BASE_URL ?? "http://127.0.0.1:5173";
const PASSWORD = process.env.WGW_E2E_PASSWORD ?? "storybook-dev";

export async function tokenFor(username: string): Promise<string> {
  const response = await fetch(`${API}/api/v1/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  expect(response.ok, await response.clone().text()).toBeTruthy();
  const tokens = (await response.json()) as { access_token?: string };
  if (!tokens.access_token) throw new Error(`Login for ${username} did not return tokens.`);
  return tokens.access_token;
}

/** A browser context whose tabs start signed in with `accessToken`. */
export async function signedInContext(
  browser: Browser,
  accessToken: string,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: APP,
    storageState: { cookies: [], origins: [] },
  });
  await context.addInitScript(
    ({ access }) => {
      localStorage.setItem("wgw.api.access_token", access);
      localStorage.setItem("wgw.api.session_kind", "member");
    },
    { access: accessToken },
  );
  return context;
}

/** The DM channel between the two users, opened by `ownerToken`. */
export async function dmChannel(
  context: BrowserContext,
  ownerToken: string,
  peer: string,
): Promise<string> {
  const dm = await context.request.post(`${API}/api/v1/chat/dms`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
    data: { principal: peer },
  });
  expect(dm.ok(), await dm.text()).toBeTruthy();
  return ((await dm.json()) as { id: string }).id;
}

export async function postDm(
  context: BrowserContext,
  senderToken: string,
  channelId: string,
  text: string,
): Promise<void> {
  const posted = await context.request.post(
    `${API}/api/v1/chat/channels/${encodeURIComponent(channelId)}/messages`,
    {
      headers: { Authorization: `Bearer ${senderToken}` },
      data: { id: ulid(), body: text },
    },
  );
  expect(posted.ok(), await posted.text()).toBeTruthy();
}

/** Resolves once a push request in any tab of the context got an event stream back. */
export function pushConnected(context: BrowserContext): Promise<unknown> {
  return context.waitForEvent("response", {
    predicate: (response) => /\/jmap\/events\//.test(response.url()) && response.status() === 200,
    timeout: 30_000,
  });
}

/** Chat message ids are ULIDs (26 Crockford base32 characters). */
function ulid(): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let time = Date.now();
  let head = "";
  for (let i = 0; i < 10; i++) {
    head = alphabet[time % 32] + head;
    time = Math.floor(time / 32);
  }
  let tail = "";
  for (let i = 0; i < 16; i++) tail += alphabet[Math.floor(Math.random() * 32)];
  return head + tail;
}
