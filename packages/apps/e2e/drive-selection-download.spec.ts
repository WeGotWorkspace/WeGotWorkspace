// Several selected items download as one zip from the floating selection
// bar (live app, #1905), in Drive and in Docs home. The server streams the
// zip; everything sits in one top folder named after the place in view.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "./helpers/live-test";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/notes-live";
import { docsHomeRow, gotoDocsHome, loginToDocs } from "./helpers/docs-live";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const RUN = Date.now().toString(36);
const FOLDER = `Sel ${RUN}`;
const DOC_A = `e2e-sel-a-${RUN}.md`;
const DOC_B = `e2e-sel-b-${RUN}.md`;
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

/** A Drive grid tile's click target, labelled with the item's name. */
function tile(page: Page, name: string) {
  return page.locator(`.drive-tile__hit[aria-label="${name}"]`);
}

/** Clicks the selection bar's Download and returns the saved zip's name and entries. */
async function downloadFromSelectionBar(page: Page): Promise<{ name: string; entries: string[] }> {
  const bar = page.locator(".drive-selection-bar");
  await expect(bar).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    bar.getByRole("button", { name: "Download", exact: true }).click(),
  ]);
  await expect(page.getByText("Download started")).toBeVisible();
  const zip = readFileSync(await download.path());
  expect(zip.subarray(0, 2).toString("latin1")).toBe("PK");
  return { name: download.suggestedFilename(), entries: zipEntryNames(zip) };
}

test.describe("Download several selected items (live app)", () => {
  test.beforeAll(async () => {
    const folder = encodeURIComponent(FOLDER);
    await dav("MKCOL", `${folder}/`);
    await dav("PUT", `${folder}/a.md`, "# A\n");
    await dav("MKCOL", `${folder}/Docs/`);
    await dav("PUT", `${folder}/Docs/c.txt`, "c\n");
    await dav("MKCOL", `${folder}/Docs/Empty/`);
    await dav("PUT", `${folder}/not-selected.txt`, "no\n");
    await dav("PUT", DOC_A, "# A\n");
    await dav("PUT", DOC_B, "# B\n");
  });

  test.afterAll(async () => {
    await dav("DELETE", `${encodeURIComponent(FOLDER)}/`);
    await dav("DELETE", DOC_A);
    await dav("DELETE", DOC_B);
  });

  test("Drive: a file and a folder save as one zip named after the folder in view", async ({
    page,
  }) => {
    await page.goto("/drive");
    await tile(page, FOLDER).dblclick({ timeout: 30_000 });
    await expect(tile(page, "not-selected.txt")).toBeVisible({ timeout: 30_000 });

    await tile(page, "a.md").click();
    await tile(page, "Docs").click({ modifiers: ["ControlOrMeta"] });

    const { name, entries } = await downloadFromSelectionBar(page);
    expect(name).toBe(`${FOLDER}.zip`);
    expect(entries).toEqual([
      `${FOLDER}/`,
      `${FOLDER}/Docs/`,
      `${FOLDER}/Docs/Empty/`,
      `${FOLDER}/Docs/c.txt`,
      `${FOLDER}/a.md`,
    ]);
  });

  test("Docs home: two selected documents save as one zip", async ({ page }) => {
    await loginToDocs(page);
    await gotoDocsHome(page);
    await expect(docsHomeRow(page, DOC_A)).toBeVisible({ timeout: 30_000 });
    await expect(docsHomeRow(page, DOC_B)).toBeVisible();

    await docsHomeRow(page, DOC_A).click();
    await docsHomeRow(page, DOC_B).click({ modifiers: ["ControlOrMeta"] });

    const { name, entries } = await downloadFromSelectionBar(page);
    expect(name).toMatch(/\.zip$/);
    const top = name.slice(0, -".zip".length);
    expect(entries).toEqual([`${top}/`, `${top}/${DOC_A}`, `${top}/${DOC_B}`]);
  });
});
