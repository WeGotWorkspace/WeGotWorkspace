import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueOutboxMutation, markOutboxError } from "@/lib/offline/core/outbox-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import type { DocsOutboxPayload } from "@/lib/offline/docs/docs-outbox-flush";
import { readDocsStarredPaths, writeDocsStarredPaths } from "@/lib/offline/docs/docs-stars-store";

const pendingSave = vi.hoisted(() => vi.fn(async (_path: string) => false));

vi.mock("@/lib/collab/docs-collab-persistence", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  hasDocsCollabPendingServerSave: pendingSave,
}));

import {
  applyDocsInboundChanges,
  docsPathAfterQueuedRenames,
  readDocsPendingWrites,
  subscribeDocsCachesChanged,
  type DocsInboundChange,
  type DocsNodeFacts,
} from "@/lib/offline/docs/docs-inbound-sync";
import {
  docsPathAfterMoves,
  subscribeDocsPathMoved,
  type DocsPathMove,
} from "@/lib/offline/docs/docs-path-moves";

const username = "alice";
const FILE: DocsNodeFacts = { directory: false, size: 7, modifiedAt: 900 };
const DIR: DocsNodeFacts = { directory: true, size: 0, modifiedAt: 900 };

async function queue(
  payload: DocsOutboxPayload,
  lastError?: string,
  domain: "docs" | "drive" = "docs",
): Promise<void> {
  const id = crypto.randomUUID();
  await enqueueOutboxMutation(username, {
    id,
    domain,
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

describe("applyDocsInboundChanges", () => {
  beforeEach(async () => {
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await db.meta.clear();
    pendingSave.mockClear();
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

  it("tells an open editor where a Doc moved elsewhere went, unless a queued write owns it", async () => {
    await queue(
      { op: "rename", from: "/users/alice/old.md", destination: "/users/alice", to: "mine.md" },
      "Service Unavailable",
    );
    const heard: Array<[string, string]> = [];
    const stop = subscribeDocsPathMoved(username, (moves) =>
      moves.forEach(({ from, to }) => heard.push([from, to])),
    );

    await applyDocsInboundChanges(username, [
      moved("/users/alice/open.md", "/users/alice/moved.md"),
      moved("/users/alice/mine.md", "/users/alice/theirs.md"),
    ]);

    await expect.poll(() => heard).toEqual([["users/alice/open.md", "users/alice/moved.md"]]);
    stop();
  });

  it("sends a swap as one batch, so an open editor follows it once (#2063 C4)", async () => {
    const batches: (readonly DocsPathMove[])[] = [];
    const stop = subscribeDocsPathMoved(username, (moves) => batches.push(moves));

    await applyDocsInboundChanges(username, [
      moved("/users/alice/a.md", "/users/alice/b.md"),
      moved("/users/alice/b.md", "/users/alice/a.md"),
    ]);

    await expect.poll(() => batches.length).toBe(1);
    stop();
    expect(batches[0]).toEqual([
      { from: "users/alice/a.md", to: "users/alice/b.md" },
      { from: "users/alice/b.md", to: "users/alice/a.md" },
    ]);
    // The editor on a.md ends on b.md: the map is applied once, not a→b→a.
    expect(docsPathAfterMoves("users/alice/a.md", batches[0]!)).toBe("users/alice/b.md");
  });

  it("tells every tab, this one included, only when the stars changed", async () => {
    await writeDocsStarredPaths(username, ["/users/alice/a.md"]);
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

  it("reads Docs home writes from the Drive outbox too (#2063 C4)", async () => {
    await queue(
      { op: "trash", from: "/users/alice/a.md", destination: "/users/alice/.Trash", to: "a.md" },
      undefined,
      "drive",
    );

    const pending = await readDocsPendingWrites(username);

    expect(pending.get("users/alice/a.md")).toMatchObject({ deleting: true, queued: true });
  });
});

describe("docsPathAfterQueuedRenames", () => {
  const rename = (from: string, destination: string, to: string): DocsOutboxPayload => ({
    op: "rename",
    from,
    destination,
    to,
  });

  it("follows a queued rename of the Doc, then a move of its folder, in queue order", () => {
    const payloads = [
      rename("/users/alice/Plans/Roadmap.md", "/users/alice/Plans", "Roadmap v2.md"),
      { op: "star", path: "/users/alice/Plans/Roadmap v2.md", starred: true } as const,
      rename("/users/alice/Plans", "/users/alice/Archive", "Plans"),
    ];
    expect(docsPathAfterQueuedRenames(payloads, "users/alice/Plans/Roadmap.md")).toBe(
      "/users/alice/Archive/Plans/Roadmap v2.md",
    );
  });

  it("is null when no queued rename moves the path, and ignores trash", () => {
    const payloads: DocsOutboxPayload[] = [
      rename("/users/alice/Other.md", "/users/alice", "Other 2.md"),
      {
        op: "trash",
        from: "/users/alice/Roadmap.md",
        destination: "/users/alice/.Trash",
        to: "Roadmap.md",
      },
    ];
    expect(docsPathAfterQueuedRenames([...payloads, null], "/users/alice/Roadmap.md")).toBeNull();
  });
});
