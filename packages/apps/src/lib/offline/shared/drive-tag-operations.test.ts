import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import type { DriveAPIOperations } from "@/lib/files/drive-types";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { listOutboxMutationsForDomain } from "@/lib/offline/core/outbox-store";
import {
  readDriveEntryFromCache,
  upsertDriveEntry,
} from "@/lib/offline/drive/drive-directory-offline-store";
import { DRIVE_DOMAIN, driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import { createHybridSetTags, tagsAfterDelta } from "@/lib/offline/shared/drive-tag-operations";

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

describe("tagsAfterDelta", () => {
  it("removes first, then adds, normalised and without repeats", () => {
    expect(tagsAfterDelta(["a", "b"], { tagsRemove: ["B"], tagsAdd: ["C", "a", "c"] })).toEqual([
      "a",
      "c",
    ]);
  });
});

describe("createHybridSetTags", () => {
  const db = () => offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const notify = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    await db().outbox.clear();
    await driveEntriesTable(db()).clear();
    await upsertDriveEntry(username, entry(["keep"]), "home");
  });

  it("offline: updates the cached row at once and merges edits into one queued row", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const setTags = createHybridSetTags(username, {} as DriveAPIOperations, DRIVE_DOMAIN, notify);

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
    const setTags = createHybridSetTags(username, live, DRIVE_DOMAIN, notify);

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
    const setTags = createHybridSetTags(username, live, DRIVE_DOMAIN, notify);

    await expect(setTags({ path, tagsAdd: ["x"] })).rejects.toThrow("forbidden");
    expect(await listOutboxMutationsForDomain(username, DRIVE_DOMAIN)).toHaveLength(0);
  });
});
