// A folder downloads as one zip from its row menu (live app, #1621).
//
// The row menu has three groups: Open first, Delete last, the other actions
// in alphabetical order between them. A folder's download is labelled
// Download like a file's; the browser saves one zip the server streams.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "./helpers/live-test";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/notes-live";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const RUN = Date.now().toString(36);
const FOLDER = `Zip ${RUN}`;
const basicAuth = `Basic ${Buffer.from(`${E2E_USERNAME}:${E2E_PASSWORD}`).toString("base64")}`;

async function dav(method: string, path: string, body?: string): Promise<void> {
  const res = await fetch(`${API}/files/users/${E2E_USERNAME}/${path}`, {
    method,
    headers: { Authorization: basicAuth, "Content-Type": "text/plain" },
    body,
  });
  if (!res.ok && !(method === "DELETE" && res.status === 404)) {
    throw new Error(`${method} ${path} failed: ${res.status}`);
  }
}

/** The entry names in a zip's central directory. */
function zipEntryNames(zip: Buffer): string[] {
  const names: string[] = [];
  for (let at = zip.indexOf("PK\x01\x02", 0, "latin1"); at >= 0;) {
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    names.push(zip.toString("utf8", at + 46, at + 46 + nameLength));
    at = zip.indexOf("PK\x01\x02", at + 46 + nameLength + extraLength + commentLength, "latin1");
  }
  return names.sort();
}

async function openFolderMenu(page: Page): Promise<void> {
  const tile = page
    .getByText(FOLDER, { exact: true })
    .locator("xpath=ancestor::*[.//button[@aria-label='More actions']][1]");
  await tile.getByRole("button", { name: "More actions" }).click();
}

test.describe("Drive folder download (live app)", () => {
  test.beforeAll(async () => {
    const folder = encodeURIComponent(FOLDER);
    await dav("MKCOL", `${folder}/`);
    await dav("PUT", `${folder}/a.md`, "# A\n");
    await dav("MKCOL", `${folder}/sub/`);
    await dav("PUT", `${folder}/sub/b.txt`, "b\n");
  });

  test.afterAll(async () => {
    await dav("DELETE", `${encodeURIComponent(FOLDER)}/`);
  });

  test("the row menu is grouped and Download saves the folder as one zip", async ({ page }) => {
    await page.goto("/drive");
    await expect(page.getByText(FOLDER, { exact: true })).toBeVisible({ timeout: 30_000 });

    await openFolderMenu(page);
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Open" })).toBeVisible();
    const entries = await menu
      .locator('[role="menuitem"], [role="separator"]')
      .evaluateAll((nodes) =>
        nodes.map((node) =>
          node.getAttribute("role") === "separator" ? "---" : (node.textContent ?? "").trim(),
        ),
      );
    expect(entries).toEqual([
      "Open",
      "---",
      "Download",
      "Move",
      "Rename",
      "Share",
      "Star",
      "---",
      "Delete",
    ]);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      menu.getByRole("menuitem", { name: "Download" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`${FOLDER}.zip`);
    const zip = readFileSync(await download.path());
    expect(zip.subarray(0, 2).toString("latin1")).toBe("PK");
    // Everything sits in one top folder named after the folder.
    expect(zipEntryNames(zip).filter((name) => !name.endsWith("/"))).toEqual([
      `${FOLDER}/a.md`,
      `${FOLDER}/sub/b.txt`,
    ]);
  });
});
