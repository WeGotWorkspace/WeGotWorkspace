import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "./helpers/live-test";
import { putDriveFile } from "./helpers/drive-seed";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/notes-live";

// #1622: a share-link guest downloads a large file natively through a
// download ticket, and can resume it with Range after a dropped connection.

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const V1 = `${API}/api/v1`;
/** Large enough to stream in many chunks; the dev PHP server takes bodies up to 32M. */
const SIZE = 24 * 1024 * 1024;
/** Bytes read before the connection is dropped. */
const DROP_AFTER = 5 * 1024 * 1024;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function ownerToken(): Promise<string> {
  const response = await fetch(`${V1}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: E2E_USERNAME, password: E2E_PASSWORD }),
  });
  expect(response.ok).toBe(true);
  return ((await response.json()) as { access_token: string }).access_token;
}

async function createPublicShare(token: string, path: string) {
  const response = await fetch(`${V1}/files/shares`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path, kind: "public", defaultAccess: "view" }),
  });
  expect(response.status).toBeLessThan(300);
  const { data } = (await response.json()) as { data: { id: string; publicToken: string } };
  return data;
}

/** Removes the seeded folder over WebDAV, as the e2e user. */
async function deleteDriveFolder(folder: string): Promise<void> {
  const basic = Buffer.from(`${E2E_USERNAME}:${E2E_PASSWORD}`).toString("base64");
  await fetch(`${API}/files/users/${E2E_USERNAME}/${encodeURIComponent(folder)}`, {
    method: "DELETE",
    headers: { Authorization: `Basic ${basic}` },
  });
}

async function deleteShare(token: string, id: string): Promise<void> {
  await fetch(`${V1}/files/shares/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// A guest has no sign-in: no saved session from the live setup.
test.use({ storageState: { cookies: [], origins: [] } });

test("a share-link guest downloads a large file natively and resumes it", async ({ page }) => {
  test.setTimeout(180_000);
  const folder = `e2e-guest-dl-${Date.now()}`;
  const name = "report.bin";
  const bytes = randomBytes(SIZE);
  // WebDAV writes hash the file, so the ticket carries a strong ETag to resume on.
  await putDriveFile(`users/${E2E_USERNAME}/${folder}/${name}`, bytes, "application/octet-stream");

  const owner = await ownerToken();
  const share = await createPublicShare(owner, `/users/${E2E_USERNAME}/${folder}/${name}`);
  try {
    const ticketRequests: string[] = [];
    const contentGets: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (request.method() === "POST" && /\/files\/download-tickets$/.test(url)) {
        ticketRequests.push(url);
      }
      if (request.method() === "GET" && /\/files\/content\?/.test(url)) contentGets.push(url);
    });

    // The share page of a file that has no browser preview downloads it on open.
    const downloadEvent = page.waitForEvent("download", { timeout: 60_000 });
    await page.goto(`/share/${share.publicToken}`);
    const download = await downloadEvent;

    // A native download from the ticket URL, not a blob: URL built from fetched bytes.
    const ticketUrl = download.url();
    expect(ticketUrl).toMatch(/\/jmap\/download-ticket\/[^/]+\/report\.bin$/);
    expect(ticketRequests).toHaveLength(1);
    expect(contentGets).toEqual([]);
    const saved = await readFile((await download.path())!);
    expect(saved.length).toBe(SIZE);
    expect(sha256(saved)).toBe(sha256(bytes));
    await expect(page.getByText("Download started")).toBeVisible();

    // The ticket URL needs no Authorization header. Drop the connection part-way…
    const abort = new AbortController();
    const first = await fetch(ticketUrl, { signal: abort.signal });
    expect(first.status).toBe(200);
    expect(first.headers.get("accept-ranges")).toBe("bytes");
    expect(first.headers.get("content-disposition") ?? "").toMatch(/attachment/);
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    const reader = first.body!.getReader();
    const parts: Uint8Array[] = [];
    let received = 0;
    while (received < DROP_AFTER) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      received += value.length;
    }
    abort.abort();
    expect(received).toBeLessThan(SIZE);

    // …then resume from where it stopped.
    const rest = await fetch(ticketUrl, {
      headers: { Range: `bytes=${received}-`, "If-Range": etag! },
    });
    expect(rest.status).toBe(206);
    expect(rest.headers.get("content-range")).toBe(`bytes ${received}-${SIZE - 1}/${SIZE}`);
    const tail = new Uint8Array(await rest.arrayBuffer());
    const whole = Buffer.concat([...parts, tail]);
    expect(whole.length).toBe(SIZE);
    expect(sha256(whole)).toBe(sha256(bytes));

    // Revoking the link stops the ticket at its next request.
    await deleteShare(owner, share.id);
    const afterRevoke = await fetch(ticketUrl, { headers: { Range: "bytes=0-9" } });
    expect(afterRevoke.status).toBe(404);
  } finally {
    await deleteShare(owner, share.id);
    await deleteDriveFolder(folder);
  }
});
