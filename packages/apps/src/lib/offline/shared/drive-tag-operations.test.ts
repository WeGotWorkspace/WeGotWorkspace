import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import type { DriveAPIOperations } from "@/lib/files/drive-types";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  listOutboxMutationsForDomain,
  settleSentOutboxMutation,
} from "@/lib/offline/core/outbox-store";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";
import { DOCS_DOMAIN } from "@/lib/offline/docs/docs-schema";
import {
  readDriveEntryFromCache,
  upsertDriveEntry,
} from "@/lib/offline/drive/drive-directory-offline-store";
import { DRIVE_DOMAIN, driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import { createHybridSetTags } from "@/lib/offline/shared/drive-tag-operations";

vi.mock("@/lib/offline/core/browser-online", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/core/browser-online")>();
  return { ...actual, readBrowserOnline: vi.fn(() => false) };
});

const username = "alice";
const path = "/users/alice/plan.md";

function entry(tags?: string[]): WgwDriveDirectoryEntry {
  return {
    path,
    name: "plan.md",
    type: "file",
    size: 1,
    time: 1,
    permissions: 644,
    myRights: fullDriveMyRights,
    ...(tags ? { tags } : {}),
  };
}

describe("createHybridSetTags", () => {
  const db = () => offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const notify = vi.fn();
  const flush = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    await db().outbox.clear();
    await driveEntriesTable(db()).clear();
    await upsertDriveEntry(username, entry(["keep"]), "home");
  });

  it("offline: updates the cached row at once and merges edits into one queued row", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const setTags = createHybridSetTags(
      username,
      {} as DriveAPIOperations,
      DRIVE_DOMAIN,
      notify,
      flush,
    );

    expect(await setTags({ path, tagsAdd: ["later"] })).toEqual(["keep", "later"]);
    expect(await setTags({ path, tagsRemove: ["later", "keep"], tagsAdd: ["fresh"] })).toEqual([
      "fresh",
    ]);

    expect((await readDriveEntryFromCache(username, path))?.tags).toEqual(["fresh"]);
    const queued = await listOutboxMutationsForDomain(username, DRIVE_DOMAIN);
    expect(queued).toHaveLength(1);
    expect(JSON.parse(queued[0]?.payload ?? "{}")).toEqual({
      op: "tags",
      path,
      tagsAdd: ["fresh"],
      tagsRemove: ["later", "keep"],
    });
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("online: asks the server and stores the tags it answers, queuing nothing", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    const live = {
      setTags: vi.fn(async () => ["keep", "server-tag"]),
    } as unknown as DriveAPIOperations;
    const setTags = createHybridSetTags(username, live, DRIVE_DOMAIN, notify, flush);

    expect(await setTags({ path, tagsAdd: ["server-tag"] })).toEqual(["keep", "server-tag"]);

    expect(live.setTags).toHaveBeenCalledWith({ path, tagsAdd: ["server-tag"] }, undefined);
    expect((await readDriveEntryFromCache(username, path))?.tags).toEqual(["keep", "server-tag"]);
    expect(await listOutboxMutationsForDomain(username, DRIVE_DOMAIN)).toHaveLength(0);
  });

  it("online: a server refusal is not queued", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    const live = {
      setTags: vi.fn(async () => {
        throw new Error("forbidden");
      }),
    } as unknown as DriveAPIOperations;
    const setTags = createHybridSetTags(username, live, DRIVE_DOMAIN, notify, flush);

    await expect(setTags({ path, tagsAdd: ["x"] })).rejects.toThrow("forbidden");
    expect(await listOutboxMutationsForDomain(username, DRIVE_DOMAIN)).toHaveLength(0);
  });

  it("merges a delta queued while the row is sent, and settling keeps it queued", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const setTags = createHybridSetTags(
      username,
      {} as DriveAPIOperations,
      DRIVE_DOMAIN,
      notify,
      flush,
    );
    await setTags({ path, tagsAdd: ["a"] });
    const [sent] = await listOutboxMutationsForDomain(username, DRIVE_DOMAIN);

    await setTags({ path, tagsAdd: ["b"] });

    const settlement = await settleSentOutboxMutation(username, sent as OfflineOutboxRow);
    expect(settlement.kind).toBe("changed");
    const queued = await listOutboxMutationsForDomain(username, DRIVE_DOMAIN);
    expect(queued).toHaveLength(1);
    expect(JSON.parse(queued[0]?.payload ?? "{}").tagsAdd).toEqual(["a", "b"]);
  });

  it("keeps one row per path across Drive and Docs, so a later remove wins", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const docs = createHybridSetTags(
      username,
      {} as DriveAPIOperations,
      DOCS_DOMAIN,
      notify,
      flush,
    );
    const drive = createHybridSetTags(
      username,
      {} as DriveAPIOperations,
      DRIVE_DOMAIN,
      notify,
      flush,
    );
    await docs({ path, tagsAdd: ["work"] });
    await drive({ path, tagsRemove: ["work"] });

    const rows = await db().outbox.toArray();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]?.payload ?? "{}").tagsAdd ?? []).not.toContain("work");
  });

  it("flushes a queued edit at once when the browser still says online", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    const live = {
      setTags: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    } as unknown as DriveAPIOperations;
    await createHybridSetTags(
      username,
      live,
      DRIVE_DOMAIN,
      notify,
      flush,
    )({ path, tagsAdd: ["x"] });
    expect(flush).toHaveBeenCalledTimes(1);
    expect(await listOutboxMutationsForDomain(username, DRIVE_DOMAIN)).toHaveLength(1);
  });

  it("an empty delta changes nothing", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const setTags = createHybridSetTags(
      username,
      {} as DriveAPIOperations,
      DRIVE_DOMAIN,
      notify,
      flush,
    );
    expect(await setTags({ path })).toEqual(["keep"]);
    expect(await db().outbox.count()).toBe(0);
  });
});
