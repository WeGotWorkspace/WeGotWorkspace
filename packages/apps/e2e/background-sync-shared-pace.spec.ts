// One browser-wide download pace (live app, #2290).
//
// Drive, Docs and Contacts tabs of one browser all copy data for offline use.
// They draw their turns from one schedule, so three open apps download no
// faster than one: about 20 background requests a minute in total.
//
// Runs in a fresh browser context: nothing cached, like a new device.
import { expect, test, type Request } from "./helpers/live-test";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/notes-live";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const RUN = Date.now().toString(36);
const FOLDER = `Shared pace ${RUN}`;
const FILES = Array.from(
  { length: 20 },
  (_, i) => `Pace ${RUN} ${String(i + 1).padStart(2, "0")}.md`,
);

/** 20 per minute: a 30 s window holds 10 starts, plus one for timing jitter. */
const MAX_BACKGROUND_REQUESTS_PER_30S = 11;

const basicAuth = `Basic ${Buffer.from(`${E2E_USERNAME}:${E2E_PASSWORD}`).toString("base64")}`;

async function dav(method: string, path: string, body?: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const headers: Record<string, string> = { Authorization: basicAuth };
    if (body !== undefined) headers["Content-Type"] = "text/markdown";
    const res = await fetch(`${API}/files/users/${E2E_USERNAME}/${path}`, {
      method,
      headers,
      body,
    });
    if (res.status !== 429) {
      const exists = method === "MKCOL" && res.status === 405;
      if (!res.ok && !exists) throw new Error(`${method} ${path} failed: ${res.status}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw new Error(`${method} ${path} stayed rate limited`);
}

/** The first two card reads (address book and first page) open the app and take no slot. */
const UNPACED_CARD_READS = 2;

/** A background sync request: a file body, or a contact card read after the first pages. */
function isBackgroundSync(
  request: Request,
  cardReads: { count: number },
): { seeded: string | null } | null {
  const url = new URL(request.url());
  if (request.method() === "GET") {
    if (
      url.pathname !== "/api/v1/files/content" &&
      url.pathname !== "/api/v1/files/collaboration"
    ) {
      return null;
    }
    const path = url.searchParams.get("path") ?? "";
    const seeded = FILES.find((name) => path.endsWith(`/${FOLDER}/${name}`)) ?? null;
    return { seeded };
  }
  if (request.method() === "POST" && url.pathname === "/api/v1/jmap") {
    if (!(request.postData() ?? "").includes("ContactCard/get")) return null;
    cardReads.count += 1;
    return cardReads.count > UNPACED_CARD_READS ? { seeded: null } : null;
  }
  return null;
}

function maxPerWindow(times: number[], windowMs: number): number {
  let max = 0;
  let start = 0;
  for (let end = 0; end < times.length; end += 1) {
    while (times[end]! - times[start]! >= windowMs) start += 1;
    max = Math.max(max, end - start + 1);
  }
  return max;
}

test("Drive, Docs and Contacts tabs share one download pace", async ({ browser }) => {
  test.setTimeout(360_000);
  await dav("MKCOL", `${encodeURIComponent(FOLDER)}/`);
  for (const name of FILES) {
    await dav("PUT", `${encodeURIComponent(FOLDER)}/${encodeURIComponent(name)}`, `# ${name}\n`);
  }

  const context = await browser.newContext();
  try {
    const times: number[] = [];
    const seeded = new Set<string>();
    const statuses: number[] = [];
    const cardReads = { count: 0 };
    context.on("request", (request) => {
      const hit = isBackgroundSync(request, cardReads);
      if (!hit) return;
      times.push(Date.now());
      if (hit.seeded) seeded.add(hit.seeded);
    });
    context.on("response", (response) => {
      if (new URL(response.url()).pathname.startsWith("/api/")) statuses.push(response.status());
    });

    const drive = await context.newPage();
    await drive.goto("/drive?view=folder&path=My%20Drive");
    const docs = await context.newPage();
    await docs.goto("/docs");
    const contacts = await context.newPage();
    await contacts.goto("/contacts/all");

    // Halfway through the copy, one tab reloads and starts over from its stored state.
    await expect
      .poll(() => seeded.size, { timeout: 120_000 })
      .toBeGreaterThanOrEqual(FILES.length / 2);
    await docs.reload();

    await expect.poll(() => seeded.size, { timeout: 240_000 }).toBe(FILES.length);

    expect(
      maxPerWindow(times, 30_000),
      "background requests from all tabs in any 30 s",
    ).toBeLessThanOrEqual(MAX_BACKGROUND_REQUESTS_PER_30S);
    expect(statuses.filter((status) => status === 429)).toEqual([]);
  } finally {
    await context.close();
  }
});
