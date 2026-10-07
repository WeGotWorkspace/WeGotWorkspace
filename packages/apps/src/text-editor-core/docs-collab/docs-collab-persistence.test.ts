import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { PENDING_SERVER_SAVE_KEY } from "./use-docs-collab-save";
import {
  clearDocsCollabPendingServerSave,
  captureDocsCollabOfflinePersistence,
  docsCollabIndexedDbKey,
  hasDocsCollabPendingServerSave,
  migrateDocsCollabPendingSaveFromLegacy,
  restoreDocsCollabOfflinePersistence,
} from "./docs-collab-persistence";

async function seedPendingSave(room: string): Promise<void> {
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(docsCollabIndexedDbKey(room), ydoc);
  await persistence.whenSynced;
  await persistence.set(PENDING_SERVER_SAVE_KEY, 1);
  await persistence.destroy();
  ydoc.destroy();
}

async function seedCollabRoom(room: string): Promise<void> {
  const ydoc = new Y.Doc();
  ydoc.getXmlFragment("default").insert(0, [new Y.XmlElement("paragraph")]);
  const persistence = new IndexeddbPersistence(docsCollabIndexedDbKey(room), ydoc);
  await persistence.whenSynced;
  await persistence.destroy();
  ydoc.destroy();
}

describe("docs-collab pending server save persistence", () => {
  it("detects and clears pending save metadata by api path", async () => {
    const apiPath = "users/alice/offline-doc.md";
    await seedPendingSave(apiPath);

    await expect(hasDocsCollabPendingServerSave(apiPath)).resolves.toBe(true);

    await clearDocsCollabPendingServerSave(apiPath);

    await expect(hasDocsCollabPendingServerSave(apiPath)).resolves.toBe(false);
  });

  it("migrates pending save metadata from a pre-v2 IndexedDB room on join", async () => {
    const room = "users/alice/migrate-pending.md";
    const legacyDoc = new Y.Doc();
    const legacyPersistence = new IndexeddbPersistence(room, legacyDoc);
    await legacyPersistence.whenSynced;
    await legacyPersistence.set(PENDING_SERVER_SAVE_KEY, 1);
    await legacyPersistence.destroy();
    legacyDoc.destroy();

    const v2Doc = new Y.Doc();
    const v2Persistence = new IndexeddbPersistence(docsCollabIndexedDbKey(room), v2Doc);
    await v2Persistence.whenSynced;
    await migrateDocsCollabPendingSaveFromLegacy(room, v2Persistence);
    await expect(v2Persistence.get(PENDING_SERVER_SAVE_KEY)).resolves.toBeTruthy();
    await v2Persistence.destroy();
    v2Doc.destroy();
  });

  it("clears legacy pending save keys stored with a leading slash", async () => {
    await seedPendingSave("/users/alice/legacy-doc.md");

    await expect(hasDocsCollabPendingServerSave("users/alice/legacy-doc.md")).resolves.toBe(true);

    await clearDocsCollabPendingServerSave("users/alice/legacy-doc.md");

    await expect(hasDocsCollabPendingServerSave("users/alice/legacy-doc.md")).resolves.toBe(false);
  });
});

describe("docs-collab offline persistence snapshot", () => {
  it("captures and restores y-indexeddb collab state", async () => {
    const apiPath = "users/alice/offline-doc.md";
    await seedCollabRoom(apiPath);
    await seedPendingSave(apiPath);

    const snapshot = await captureDocsCollabOfflinePersistence(apiPath);
    expect(snapshot?.yjsUpdate.length).toBeGreaterThan(0);
    expect(snapshot?.pendingServerSave).toBe(true);

    await clearRoom(apiPath);

    await restoreDocsCollabOfflinePersistence(apiPath, snapshot!);

    await expect(hasDocsCollabPendingServerSave(apiPath)).resolves.toBe(true);
    const restored = await captureDocsCollabOfflinePersistence(apiPath);
    expect(restored?.pendingServerSave).toBe(true);
    expect(restored?.yjsUpdate).toEqual(snapshot?.yjsUpdate);
  });
});

async function clearRoom(room: string): Promise<void> {
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(docsCollabIndexedDbKey(room), ydoc);
  await persistence.whenSynced;
  await persistence.clearData();
  await persistence.destroy();
  ydoc.destroy();
}
