import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { isYDocEmpty } from "@/text-editor-core/docs-collab/docs-collab-utils";

vi.mock("@/lib/offline/docs/docs-pin-hydrate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/docs/docs-pin-hydrate")>();
  return {
    ...actual,
    hydrateDocsCollabForOffline: vi.fn(async ({ apiPath }: { apiPath: string }) => {
      const room = apiPath.replace(/^\/+/, "");
      const ydoc = new Y.Doc();
      const persistence = new IndexeddbPersistence(room, ydoc);
      await persistence.whenSynced;
      ydoc.getXmlFragment("default").insert(0, [new Y.XmlElement("paragraph")]);
      await persistence.destroy();
      ydoc.destroy();
    }),
  };
});

vi.mock("@/text-editor-core/docs-collab/docs-collab-persistence", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/text-editor-core/docs-collab/docs-collab-persistence")>();
  return {
    ...actual,
    clearDocsCollabOfflinePersistence: vi.fn(async (apiPath: string) => {
      const room = apiPath.replace(/^\/+/, "");
      const ydoc = new Y.Doc();
      const persistence = new IndexeddbPersistence(room, ydoc);
      await persistence.whenSynced;
      await persistence.clearData();
      await persistence.destroy();
      ydoc.destroy();
    }),
    migrateCollabPersistence: vi.fn(),
  };
});

import { hydrateDocsCollabForOffline } from "@/lib/offline/docs/docs-pin-hydrate";
import { clearDocsCollabOfflinePersistence } from "@/text-editor-core/docs-collab/docs-collab-persistence";
import {
  listDocsAvailability,
  migrateDocsAvailabilityPath,
  writeDocsAvailability,
} from "@/lib/offline/docs/docs-availability-store";
import { fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";
import { upsertDriveEntry } from "@/lib/offline/drive/drive-directory-offline-store";
import "@/lib/offline/drive/drive-schema";
import {
  makeDocsOfflineAvailable,
  removeDocsOfflineCopy,
} from "@/lib/offline/docs/docs-offline-pin-core";

describe("docs offline pin core", () => {
  const username = "ada";
  const apiPath = "users/ada/pinned.md";

  beforeEach(async () => {
    vi.clearAllMocks();
    const { offlineDbForAccount, offlineAccountKeyFromUsername } =
      await import("@/lib/offline/core/offline-db");
    const { docsAvailabilityTable } = await import("@/lib/offline/docs/docs-schema");
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await docsAvailabilityTable(db).clear();
  });

  it("pin hydrates collab persistence and writes availability", async () => {
    await makeDocsOfflineAvailable(username, apiPath, "My Drive");
    expect(hydrateDocsCollabForOffline).toHaveBeenCalled();
    const rows = await listDocsAvailability(username);
    expect(rows.some((row) => row.id === apiPath)).toBe(true);

    const ydoc = new Y.Doc();
    const persistence = new IndexeddbPersistence(apiPath, ydoc);
    await persistence.whenSynced;
    expect(isYDocEmpty(ydoc)).toBe(false);
    await persistence.destroy();
    ydoc.destroy();
  });

  it("records the cached FileNode id on a new pin", async () => {
    await upsertDriveEntry(username, {
      type: "file",
      path: `/${apiPath}`,
      name: "pinned.md",
      size: 1,
      time: 1,
      permissions: 0,
      myRights: fullDriveMyRights,
      nodeId: "fn-pinned",
    });

    await makeDocsOfflineAvailable(username, apiPath, "My Drive");

    const rows = await listDocsAvailability(username);
    expect(rows.find((row) => row.id === apiPath)?.nodeId).toBe("fn-pinned");
  });

  it("remove clears persistence and availability row", async () => {
    await writeDocsAvailability(username, { id: apiPath, location: "My Drive" });
    await removeDocsOfflineCopy(username, apiPath);
    expect(clearDocsCollabOfflinePersistence).toHaveBeenCalledWith(apiPath);
    expect(await listDocsAvailability(username)).toHaveLength(0);
  });

  it("rename migrates availability registry path", async () => {
    await writeDocsAvailability(username, { id: apiPath, location: "My Drive" });
    await migrateDocsAvailabilityPath(username, apiPath, "users/ada/renamed.md");
    const rows = await listDocsAvailability(username);
    expect(rows[0]?.id).toBe("users/ada/renamed.md");
  });
});
