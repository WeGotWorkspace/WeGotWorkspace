import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "./helpers/live-test";
import {
  goOfflineKeepingShell,
  goOnlineAgain,
  jmapFileNodes,
  openMyDrive,
  uniqueName,
  type FileNodeRow,
} from "./helpers/drive-upload-live";

function folderInput(page: Page) {
  return page.locator('input[type="file"][aria-label="Upload folder"]');
}

/** A picked folder: `a.txt`, a system file, `sub/deep/big.bin` and an empty folder. */
function makeTree(root: string, bigBytes: number): string {
  const dir = join(mkdtempSync(join(tmpdir(), "wgw-folder-")), root);
  mkdirSync(join(dir, "sub", "deep"), { recursive: true });
  mkdirSync(join(dir, "empty"));
  writeFileSync(join(dir, "a.txt"), "folder upload a");
  writeFileSync(join(dir, ".DS_Store"), "junk");
  writeFileSync(join(dir, "sub", "deep", "big.bin"), Buffer.alloc(bigBytes, 7));
  return dir;
}

async function nodes(page: Page): Promise<FileNodeRow[]> {
  return (await jmapFileNodes(page, "FileNode/get", { ids: null })).list as FileNodeRow[];
}

/** Paths below the folder `root` on the server, one entry per node. */
async function treeOf(page: Page, root: string): Promise<string[]> {
  const all = await nodes(page);
  const byId = new Map(all.map((node) => [node.id, node]));
  const pathOf = (node: FileNodeRow): string => {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    return parent ? `${pathOf(parent)}/${node.name}` : node.name;
  };
  return all
    .map(pathOf)
    .filter((path) => path.includes(`/${root}/`) || path.endsWith(`/${root}`))
    .map((path) => path.slice(path.indexOf(`/${root}`) + 1))
    .sort();
}

test.describe("Drive folder upload (live app)", () => {
  test("a nested folder with a large file survives a reload and lands once", async ({ page }) => {
    const root = uniqueName("folder");
    const dir = makeTree(root, 9 * 1024 * 1024);
    try {
      await openMyDrive(page);
      await page.route("**/jmap/upload**", () => new Promise<void>(() => {}));
      await folderInput(page).setInputFiles(dir);
      await expect(page.getByText(/Left out 1 hidden or system item/)).toBeVisible();
      await expect(page.getByText(root, { exact: true })).toBeVisible({ timeout: 30_000 });

      // The 9 MB file asks whether to keep it on this device; the default removes it.
      const dialog = page.getByRole("dialog", { name: "Keep this file on this device?" });
      await expect(dialog).toBeVisible({ timeout: 30_000 });
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();

      // The folder is made on the server; its big file is still held.
      await expect
        .poll(async () => (await treeOf(page, root)).join(","), { timeout: 60_000 })
        .toContain(`${root}/sub/deep`);
      await page.unroute("**/jmap/upload**");
      await page.reload();
      await expect(folderInput(page)).toBeAttached({ timeout: 30_000 });
      await expect
        .poll(async () => (await treeOf(page, root)).join(","), { timeout: 120_000 })
        .toContain(`${root}/sub/deep/big.bin`);
      await expect(page.locator(".drive-upload-status")).toHaveCount(0, { timeout: 60_000 });

      const tree = await treeOf(page, root);
      expect(tree).toContain(`${root}/a.txt`);
      expect(tree.filter((path) => path === root)).toHaveLength(1);
      expect(tree.filter((path) => path.endsWith("big.bin"))).toHaveLength(1);
      expect(tree.some((path) => path.endsWith(".DS_Store"))).toBe(false);
    } finally {
      rmSync(join(dir, ".."), { recursive: true, force: true });
    }
  });

  test("a folder picked offline shows placeholders and uploads once online", async ({ page }) => {
    const root = uniqueName("folder-offline");
    const dir = makeTree(root, 1024);
    try {
      await openMyDrive(page);
      await goOfflineKeepingShell(page);
      await folderInput(page).setInputFiles(dir);
      await expect(page.getByText(root, { exact: true })).toBeVisible({ timeout: 30_000 });

      await goOnlineAgain(page);
      await expect(page.locator(".drive-upload-status")).toHaveCount(0, { timeout: 120_000 });
      await expect(page.getByText(root, { exact: true })).toBeVisible();

      const tree = await treeOf(page, root);
      expect(tree).toContain(`${root}/a.txt`);
      expect(tree).toContain(`${root}/sub/deep/big.bin`);
      expect(tree.filter((path) => path === root)).toHaveLength(1);
      expect(tree.some((path) => path.endsWith(".DS_Store"))).toBe(false);
    } finally {
      rmSync(join(dir, ".."), { recursive: true, force: true });
    }
  });
});
