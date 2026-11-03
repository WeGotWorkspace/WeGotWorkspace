import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WgwUnifiedSearchResult } from "@/lib/api/wgw/search";
import { enqueueOutboxMutation, markOutboxError } from "@/lib/offline/core/outbox-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import type { DocsOutboxPayload } from "@/lib/offline/docs/docs-outbox-flush";
import { docsListingRowsTable } from "@/lib/offline/docs/docs-schema";
import { readDocsStarredPaths, writeDocsStarredPaths } from "@/lib/offline/docs/docs-stars-store";
import {
  readDocsListingFromCache,
  writeDocsListingToCache,
} from "@/lib/offline/docs-listing-offline-store";
import type { DocsListingBrowseFilters } from "@/lib/offline/docs/docs-listing-cache-key";

const pendingSave = vi.hoisted(() => vi.fn(async (_path: string) => false));

vi.mock("@/text-editor-core/docs-collab/docs-collab-persistence", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  hasDocsCollabPendingServerSave: pendingSave,
}));

import {
  applyDocsInboundChanges,
  mergeLiveDocsListing,
  readDocsPendingWrites,
  subscribeDocsCachesChanged,
  type DocsInboundChange,
  type DocsNodeFacts,
} from "@/lib/offline/docs/docs-inbound-sync";

const username = "alice";
const ALL: DocsListingBrowseFilters = {};
const MINE: DocsListingBrowseFilters = { pathPrefix: "users/alice" };
const TEAM: DocsListingBrowseFilters = { pathPrefix: "groups/team" };
const SEARCH: DocsListingBrowseFilters = { query: "plan" };
const FILE: DocsNodeFacts = { directory: false, size: 7, modifiedAt: 900 };
const DIR: DocsNodeFacts = { directory: true, size: 0, modifiedAt: 900 };

function doc(sourceKey: string, id = 1, modifiedAt = 100): WgwUnifiedSearchResult {
  const title = sourceKey.split("/").pop() ?? sourceKey;
  return {
    id,
    sourceType: "file",
    sourceKey,
    title,
    extension: title.split(".").pop() ?? null,
    category: "document",
    size: 3,
    modifiedAt,
  };
}

async function cache(filters: DocsListingBrowseFilters, keys: string[]): Promise<void> {
  await writeDocsListingToCache(username, filters, {
    results: keys.map((key, at) => doc(key, at + 1, 100 + at)),
    hasMore: false,
  });
}

async function keys(filters: DocsListingBrowseFilters): Promise<string[] | undefined> {
  const cached = await readDocsListingFromCache(username, filters);
  return cached?.results.map((row) => row.sourceKey).sort();
}

async function queue(payload: DocsOutboxPayload, lastError?: string): Promise<void> {
  const id = crypto.randomUUID();
  await enqueueOutboxMutation(username, {
    id,
    domain: "docs",
    op: payload.op,
    payload: JSON.stringify(payload),
  });
  if (lastError) await markOutboxError(username, id, lastError, 503);
}

const removed = (path: string): DocsInboundChange => ({ kind: "removed", path });
const moved = (from: string, to: string, node = FILE): DocsInboundChange => ({
  kind: "moved",
  from,
  to,
  node,
});
const upserted = (path: string, node = FILE): DocsInboundChange => ({
  kind: "upserted",
  path,
  node,
});

describe("applyDocsInboundChanges", () => {
  beforeEach(async () => {
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await db.meta.clear();
    await docsListingRowsTable(db).clear();
    pendingSave.mockClear();
  });

  it("removes a Doc deleted elsewhere from every cached view", async () => {
    await cache(ALL, ["users/alice/a.md", "users/alice/plan.md", "groups/team/t.md"]);
    await cache(MINE, ["users/alice/a.md", "users/alice/plan.md"]);
    await cache(SEARCH, ["users/alice/plan.md"]);

    expect(await applyDocsInboundChanges(username, [removed("/users/alice/plan.md")])).toBe(true);

    expect(await keys(ALL)).toEqual(["groups/team/t.md", "users/alice/a.md"]);
    expect(await keys(MINE)).toEqual(["users/alice/a.md"]);
    // The last row of a view went: the view reads as empty, not as uncached.
    expect(await keys(SEARCH)).toEqual([]);
  });

  it("moves a renamed Doc in every view, search views included, and keeps its id", async () => {
    await cache(ALL, ["users/alice/plan.md"]);
    await cache(MINE, ["users/alice/plan.md"]);
    await cache(SEARCH, ["users/alice/plan.md"]);

    await applyDocsInboundChanges(username, [
      moved("/users/alice/plan.md", "/users/alice/plan v2.md"),
    ]);

    for (const filters of [ALL, MINE, SEARCH]) {
      const cached = await readDocsListingFromCache(username, filters);
      expect(cached?.results).toEqual([
        expect.objectContaining({
          id: 1,
          sourceKey: "users/alice/plan v2.md",
          title: "plan v2.md",
          extension: "md",
          modifiedAt: 900,
        }),
      ]);
    }
  });

  it("moves a Doc between drives: it leaves My Drive and joins the group view", async () => {
    await cache(ALL, ["users/alice/a.md", "users/alice/b.md"]);
    await cache(MINE, ["users/alice/a.md", "users/alice/b.md"]);
    await cache(TEAM, ["groups/team/t.md"]);

    await applyDocsInboundChanges(username, [moved("/users/alice/b.md", "/groups/team/b.md")]);

    expect(await keys(ALL)).toEqual(["groups/team/b.md", "users/alice/a.md"]);
    expect(await keys(MINE)).toEqual(["users/alice/a.md"]);
    expect(await keys(TEAM)).toEqual(["groups/team/b.md", "groups/team/t.md"]);
  });

  it("drops a Doc moved to Trash or renamed to a non-Docs file from every view", async () => {
    await cache(ALL, ["users/alice/a.md", "users/alice/b.md"]);

    await applyDocsInboundChanges(username, [
      moved("/users/alice/a.md", "/users/alice/.Trash/a.md"),
      moved("/users/alice/b.md", "/users/alice/b.pdf"),
    ]);

    expect(await keys(ALL)).toEqual([]);
  });

  it("moves every row under a renamed folder", async () => {
    await cache(ALL, ["users/alice/Old/a.md", "users/alice/Old/sub/b.md", "users/alice/Older.md"]);

    await applyDocsInboundChanges(username, [moved("/users/alice/Old", "/users/alice/New", DIR)]);

    expect(await keys(ALL)).toEqual([
      "users/alice/New/a.md",
      "users/alice/New/sub/b.md",
      "users/alice/Older.md",
    ]);
  });

  it("adds a Doc created elsewhere to the browse views it belongs to only", async () => {
    await cache(ALL, ["users/alice/a.md"]);
    await cache(MINE, ["users/alice/a.md"]);
    await cache(TEAM, ["groups/team/t.md"]);
    await cache(SEARCH, ["users/alice/plan.md"]);

    await applyDocsInboundChanges(username, [
      upserted("/users/alice/new plan.md"),
      upserted("/users/alice/.notes/n.md"),
      upserted("/users/alice/photo.png"),
      upserted("/users/alice/Folder", DIR),
    ]);

    expect(await keys(ALL)).toEqual(["users/alice/a.md", "users/alice/new plan.md"]);
    expect(await keys(MINE)).toEqual(["users/alice/a.md", "users/alice/new plan.md"]);
    expect(await keys(TEAM)).toEqual(["groups/team/t.md"]);
    // A search view cannot check its query offline: it gains nothing.
    expect(await keys(SEARCH)).toEqual(["users/alice/plan.md"]);
  });

  it("keeps a row a queued write owns", async () => {
    await cache(ALL, ["users/alice/offline.md", "users/alice/renamed.md"]);
    await queue({ op: "create", apiPath: "/users/alice/offline.md", content: "# x" });
    await queue(
      { op: "rename", from: "/users/alice/old.md", destination: "/users/alice", to: "renamed.md" },
      "Service Unavailable",
    );

    await applyDocsInboundChanges(username, [
      removed("/users/alice/offline.md"),
      moved("/users/alice/renamed.md", "/users/alice/elsewhere.md"),
    ]);

    expect(await keys(ALL)).toEqual(["users/alice/offline.md", "users/alice/renamed.md"]);
  });

  it("does not bring back a path a queued trash or rename left", async () => {
    await cache(ALL, ["users/alice/a.md"]);
    await queue({
      op: "trash",
      from: "/users/alice/gone.md",
      destination: "/users/alice/.Trash",
      to: "gone.md",
    });
    await queue({
      op: "rename",
      from: "/users/alice/old.md",
      destination: "/users/alice",
      to: "new.md",
    });

    await applyDocsInboundChanges(username, [
      upserted("/users/alice/gone.md"),
      upserted("/users/alice/old.md"),
    ]);

    expect(await keys(ALL)).toEqual(["users/alice/a.md"]);
  });

  it("shows a Doc trashed offline again under the name it got elsewhere (deliberate)", async () => {
    // The queued trash names the old path only, and its server write fails
    // once the old path is gone: the Doc is not trashed, so it is listed.
    await cache(ALL, ["users/alice/a.md"]);
    await queue({
      op: "trash",
      from: "/users/alice/gone.md",
      destination: "/users/alice/.Trash",
      to: "gone.md",
    });

    await applyDocsInboundChanges(username, [
      moved("/users/alice/gone.md", "/users/alice/renamed.md"),
    ]);

    expect(await keys(ALL)).toEqual(["users/alice/a.md", "users/alice/renamed.md"]);
  });

  it("does not keep a Doc deleted elsewhere for a queued star", async () => {
    await cache(ALL, ["users/alice/a.md"]);
    await queue({ op: "star", path: "/users/alice/a.md", starred: true });

    await applyDocsInboundChanges(username, [removed("/users/alice/a.md")]);

    expect(await keys(ALL)).toEqual([]);
  });

  it("moves and drops cached starred paths with their Docs", async () => {
    await writeDocsStarredPaths(username, [
      "/users/alice/a.md",
      "/users/alice/Old/b.md",
      "/users/alice/keep.md",
    ]);

    await applyDocsInboundChanges(username, [
      removed("/users/alice/a.md"),
      moved("/users/alice/Old", "/users/alice/New", DIR),
    ]);

    expect((await readDocsStarredPaths(username)).sort()).toEqual([
      "/users/alice/New/b.md",
      "/users/alice/keep.md",
    ]);
  });

  it("tells every tab, this one included, only when a cache changed", async () => {
    await cache(ALL, ["users/alice/a.md"]);
    const heard = vi.fn();
    const stop = subscribeDocsCachesChanged(username, heard);

    expect(await applyDocsInboundChanges(username, [removed("/users/alice/other.md")])).toBe(false);
    expect(heard).not.toHaveBeenCalled();

    await applyDocsInboundChanges(username, [removed("/users/alice/a.md")]);
    expect(heard).toHaveBeenCalledOnce();
    stop();
  });
});

describe("readDocsPendingWrites", () => {
  beforeEach(async () => {
    await offlineDbForAccount(offlineAccountKeyFromUsername(username)).outbox.clear();
  });

  it("reads a queued rename as the old path leaving and the new path owned", async () => {
    await queue({
      op: "rename",
      from: "/users/alice/old.md",
      destination: "/users/alice/Sub",
      to: "new.md",
    });

    const pending = await readDocsPendingWrites(username);

    expect(pending.get("users/alice/old.md")).toMatchObject({ deleting: true, queued: true });
    expect(pending.get("users/alice/Sub/new.md")?.fields).toEqual(new Set(["location"]));
  });
});

describe("mergeLiveDocsListing", () => {
  beforeEach(async () => {
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await db.meta.clear();
    await docsListingRowsTable(db).clear();
    pendingSave.mockReset();
    pendingSave.mockResolvedValue(false);
  });

  it("keeps queued rows the live listing lacks and drops rows a queued trash hides", async () => {
    await cache(MINE, [
      "users/alice/offline.md",
      "users/alice/new.md",
      "users/alice/gone-elsewhere.md",
    ]);
    await queue({ op: "create", apiPath: "/users/alice/offline.md", content: "# x" });
    await queue({
      op: "rename",
      from: "/users/alice/old.md",
      destination: "/users/alice",
      to: "new.md",
    });
    await queue({
      op: "trash",
      from: "/users/alice/trashed.md",
      destination: "/users/alice/.Trash",
      to: "trashed.md",
    });

    const merged = await mergeLiveDocsListing(username, MINE, [
      doc("users/alice/old.md", 11),
      doc("users/alice/trashed.md", 12),
      doc("users/alice/live.md", 13),
    ]);

    expect(merged.map((row) => row.sourceKey).sort()).toEqual([
      "users/alice/live.md",
      "users/alice/new.md",
      "users/alice/offline.md",
    ]);
  });

  it("keeps a Doc with unsaved collab text that the server no longer lists", async () => {
    await cache(MINE, ["users/alice/unsaved.md", "users/alice/deleted.md"]);
    pendingSave.mockImplementation(async (path: string) => path === "users/alice/unsaved.md");

    const merged = await mergeLiveDocsListing(username, MINE, [doc("users/alice/live.md")]);

    expect(merged.map((row) => row.sourceKey).sort()).toEqual([
      "users/alice/live.md",
      "users/alice/unsaved.md",
    ]);
  });

  it("is the live listing when nothing is cached or queued", async () => {
    const live = [doc("users/alice/a.md", 1, 50), doc("users/alice/b.md", 2, 90)];
    const merged = await mergeLiveDocsListing(username, MINE, live);
    expect(merged).toEqual(live);
  });
});
