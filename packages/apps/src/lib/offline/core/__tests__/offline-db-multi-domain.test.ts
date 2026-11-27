import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import "@/lib/offline/contacts/contacts-schema";
import "@/lib/offline/drive/drive-schema";
import "@/lib/offline/docs/docs-schema";
import "@/lib/offline/notes/notes-schema";
import "@/lib/offline/tasks/tasks-schema";
import { registerOfflineDomainTables, WgwOfflineDatabase } from "@/lib/offline/core/offline-db";
import {
  NOTES_OFFLINE_VERSION,
  TASKS_OFFLINE_VERSION,
} from "@/lib/offline/core/offline-version-allocation";
import { seedOfflineVersionOwnerForTests } from "@/lib/offline/core/offline-version-allocation";
import { contactsCardsTable } from "@/lib/offline/contacts/contacts-schema";
import {
  notesNotesTable,
  NOTES_DOMAIN,
} from "@/lib/offline/__tests__/fixtures/notes-offline-fixture";

const dbName = (key: string) => `wgw-offline-${key}`;

describe("offline db multi-domain registry", () => {
  it("opens fresh with core, contacts, notes, and docs tables at the latest version", async () => {
    const db = new WgwOfflineDatabase("multi-fresh");
    await db.open();

    expect(db.verno).toBe(TASKS_OFFLINE_VERSION.updatedAtIndex);
    expect(db.tables.map((t) => t.name).sort()).toEqual(
      expect.arrayContaining([
        "contacts_address_books",
        "contacts_cards",
        "docs_availability",
        "drive_availability",
        "drive_content_blobs",
        "drive_entries",
        "meta",
        "notes_notebooks",
        "notes_notes",
        "outbox",
        "tasks_items",
        "tasks_task_lists",
      ]),
    );

    await db.delete();
  });

  it("keeps domain tables isolated while sharing one database", async () => {
    const db = new WgwOfflineDatabase("multi-isolated");
    await db.open();

    await contactsCardsTable(db).put({
      id: "contact-1",
      addressBookId: "default",
      data: '{"name":"Ada"}',
      pendingSync: false,
      updatedAt: 100,
    });
    await notesNotesTable(db).put({
      id: "page-1",
      notebookId: "nb-1",
      data: '{"id":"page-1","title":"Draft"}',
      pendingSync: false,
      updatedAt: 200,
    });
    await db.outbox.put({
      id: "contacts-op",
      domain: "contacts",
      op: "update",
      payload: "{}",
      createdAt: 1,
      retries: 0,
    });
    await db.outbox.put({
      id: "notes-op",
      domain: NOTES_DOMAIN,
      op: "create",
      payload: "{}",
      createdAt: 2,
      retries: 0,
    });

    expect(await contactsCardsTable(db).count()).toBe(1);
    expect(await notesNotesTable(db).count()).toBe(1);
    expect(await db.outbox.where("domain").equals("contacts").count()).toBe(1);
    expect(await db.outbox.where("domain").equals(NOTES_DOMAIN).count()).toBe(1);

    await db.delete();
  });

  it("composes version steps from both domains when upgrading from core-only v1", async () => {
    const legacy = new Dexie(dbName("multi-upgrade"));
    legacy.version(1).stores({ meta: "key", outbox: "id, domain, createdAt" });
    await legacy.open();
    await legacy.table("meta").put({ key: "shared:session", value: "{}" });
    await legacy.table("outbox").put({
      id: "legacy-op",
      domain: "contacts",
      op: "update",
      payload: "{}",
      createdAt: 1,
      retries: 0,
    });
    legacy.close();

    const db = new WgwOfflineDatabase("multi-upgrade");
    await db.open();

    expect(db.verno).toBe(TASKS_OFFLINE_VERSION.updatedAtIndex);
    expect(await db.meta.get("shared:session")).toBeTruthy();
    expect(await db.outbox.get("legacy-op")).toBeTruthy();
    expect(db.tables.map((t) => t.name)).toContain("contacts_cards");
    expect(db.tables.map((t) => t.name)).toContain("notes_notes");
    // Docs home lists the Drive tree since #2063 C4: the listing cache is dropped.
    expect(db.tables.map((t) => t.name)).not.toContain("docs_listing_rows");
    expect(db.tables.map((t) => t.name)).toContain("docs_availability");

    await db.delete();
  });

  it("runs the notes v10 -> v11 migration while contacts remains registered", async () => {
    const legacy = new Dexie(dbName("multi-migrate-notes"));
    legacy.version(1).stores({ meta: "key", outbox: "id, domain, createdAt" });
    legacy.version(2).stores({
      meta: "key",
      outbox: "id, domain, createdAt",
      contacts_address_books: "id",
      contacts_cards: "id, addressBookId, pendingSync",
    });
    legacy.version(3).stores({
      meta: "key",
      outbox: "id, domain, createdAt",
      contacts_address_books: "id",
      contacts_cards: "id, addressBookId, pendingSync, updatedAt",
    });
    legacy.version(NOTES_OFFLINE_VERSION.tables).stores({
      meta: "key",
      outbox: "id, domain, createdAt",
      contacts_address_books: "id",
      contacts_cards: "id, addressBookId, pendingSync, updatedAt",
      notes_notebooks: "id",
      notes_notes: "id, notebookId, pendingSync",
    });
    await legacy.open();
    await legacy.table("notes_notes").put({
      id: "p1",
      notebookId: "nb1",
      data: "{}",
      pendingSync: false,
    });
    legacy.close();

    const db = new WgwOfflineDatabase("multi-migrate-notes");
    await db.open();

    const page = await notesNotesTable(db).get("p1");
    expect(typeof page?.updatedAt).toBe("number");

    const byRecency = await notesNotesTable(db).orderBy("updatedAt").toArray();
    expect(byRecency.map((row) => row.id)).toEqual(["p1"]);

    await db.delete();
  });

  it("rejects registration when two domains claim the same Dexie version (#212)", () => {
    seedOfflineVersionOwnerForTests(10, "contacts");

    expect(() =>
      registerOfflineDomainTables({
        domain: "notes",
        versions: [{ version: 10, stores: { notes_notes: "id" } }],
      }),
    ).toThrow(/already claimed by domain "contacts"/);
  });
});
