// Drive: a share-link guest downloads a large file natively through a download
// ticket (#1622), and resumes it with Range/If-Range after a dropped connection.
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "./helpers/live-test";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/notes-live";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const APP = process.env.WGW_APPS_E2E_BASE_URL ?? "http://127.0.0.1:5173";
// The PHP dev server caps a PUT body at post_max_size (8M), so seed under that.
const SIZE = 6 * 1024 * 1024;

function sha256(...parts: Buffer[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest("hex");
}

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Drive guest large download (live app)", () => {
  test.describe.configure({ timeout: 180_000 });

  test("a guest downloads a large shared file natively and resumes it after a drop", async ({
    browser,
  }) => {
    const name = `e2e-guest-large-${Date.now()}.bin`;
    const apiPath = `/users/${E2E_USERNAME}/${name}`;
    const bytes = randomBytes(SIZE);
    const expected = sha256(bytes);

    const basic = `Basic ${Buffer.from(`${E2E_USERNAME}:${E2E_PASSWORD}`).toString("base64")}`;
    const put = await fetch(`${API}/files${apiPath}`, {
      method: "PUT",
      headers: { Authorization: basic, "Content-Type": "application/octet-stream" },
      body: bytes,
    });
    expect(put.ok, `seed failed (${put.status})`).toBeTruthy();

    const tokenResponse = await fetch(`${API}/api/v1/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: E2E_USERNAME, password: E2E_PASSWORD }),
    });
    expect(tokenResponse.ok).toBeTruthy();
    const access = ((await tokenResponse.json()) as { access_token: string }).access_token;
    const ownerHeaders = { Authorization: `Bearer ${access}`, "Content-Type": "application/json" };
    const created = await fetch(`${API}/api/v1/files/shares`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ path: apiPath, kind: "public", defaultAccess: "view" }),
    });
    expect(created.ok, await created.clone().text()).toBeTruthy();
    const share = ((await created.json()) as { data: { id: string; publicToken: string } }).data;
    expect(share.publicToken).toBeTruthy();

    const guest = await browser.newContext({
      baseURL: APP,
      storageState: { cookies: [], origins: [] },
    });
    try {
      const page = await guest.newPage();
      const downloadEvent = page.waitForEvent("download", { timeout: 90_000 });
      await page.goto(`/share/${share.publicToken}`);
      const download = await downloadEvent;

      // A native download of the ticket URL, never a blob: URL.
      const ticketUrl = download.url();
      expect(ticketUrl).toContain("/jmap/download-ticket/");
      expect(ticketUrl.startsWith("blob:")).toBe(false);
      const saved = await download.path();
      expect(saved).toBeTruthy();
      expect(sha256(await readFile(saved!))).toBe(expected);

      // Resume: the connection drops after part of the body, then Range + If-Range.
      const controller = new AbortController();
      const first = await fetch(ticketUrl, { signal: controller.signal });
      expect(first.status).toBe(200);
      const etag = first.headers.get("etag");
      expect(etag).toBeTruthy();
      const received: Buffer[] = [];
      let receivedBytes = 0;
      const reader = first.body!.getReader();
      while (receivedBytes < 1024 * 1024) {
        const { done, value } = await reader.read();
        if (done) break;
        received.push(Buffer.from(value));
        receivedBytes += value.byteLength;
      }
      controller.abort();
      await reader.cancel().catch(() => undefined);
      expect(receivedBytes).toBeGreaterThan(0);
      expect(receivedBytes).toBeLessThan(SIZE);

      const rest = await guest.request.get(ticketUrl, {
        headers: { Range: `bytes=${receivedBytes}-`, "If-Range": etag! },
      });
      expect(rest.status()).toBe(206);
      const joined = Buffer.concat([...received, await rest.body()]);
      expect(joined.length).toBe(SIZE);
      expect(sha256(joined)).toBe(expected);
    } finally {
      await guest.close();
      await fetch(`${API}/api/v1/files/shares/${share.id}`, {
        method: "DELETE",
        headers: ownerHeaders,
      });
      await fetch(`${API}/files${apiPath}`, {
        method: "DELETE",
        headers: { Authorization: basic },
      });
    }
  });
});
