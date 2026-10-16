/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { listFailedCalendarOutbox } from "@/lib/offline/calendars-offline-store";
import { CALENDARS_DOMAIN } from "@/lib/offline/calendars/calendars-schema";
import { listFailedContactOutbox } from "@/lib/offline/contacts-offline-store";
import { CONTACTS_DOMAIN } from "@/lib/offline/contacts/contacts-schema";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  enqueueOutboxMutation,
  isPermanentlyFailedOutboxRow,
  isRetryableOutboxRow,
  markOutboxError,
} from "@/lib/offline/core/outbox-store";
import { listFailedNotesOutbox } from "@/lib/offline/notes-offline-store";
import { NOTES_DOMAIN } from "@/lib/offline/notes/notes-schema";
import { listFailedTaskOutbox } from "@/lib/offline/tasks-offline-store";
import { TASKS_DOMAIN } from "@/lib/offline/tasks/tasks-schema";

const username = "alice";

async function failRow(
  id: string,
  domain: string,
  message: string,
  status?: number,
): Promise<void> {
  await enqueueOutboxMutation(username, {
    id,
    domain,
    op: "update",
    payload: "{}",
  });
  await markOutboxError(username, id, message, status);
}

describe("domain failed outbox notices", () => {
  beforeEach(async () => {
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
  });

  it("keeps client 404 messages visible when lastStatus is 404", async () => {
    await failRow("contacts-book", CONTACTS_DOMAIN, "AddressBook/get did not return book-1", 404);
    await failRow("contacts-card", CONTACTS_DOMAIN, "ContactCard/get did not return card-1", 404);
    await failRow(
      "calendars-event",
      CALENDARS_DOMAIN,
      "CalendarEvent/set returned no created id",
      404,
    );
    await failRow("notes-book", NOTES_DOMAIN, "Notebook not found", 404);
    await failRow("tasks-item", TASKS_DOMAIN, "GET /tasks/items/missing failed (404)", 404);

    expect((await listFailedContactOutbox(username)).map((row) => row.id)).toEqual([
      "contacts-book",
      "contacts-card",
    ]);
    expect((await listFailedCalendarOutbox(username)).map((row) => row.id)).toEqual([
      "calendars-event",
    ]);
    expect((await listFailedNotesOutbox(username)).map((row) => row.id)).toEqual(["notes-book"]);
    expect((await listFailedTaskOutbox(username)).map((row) => row.id)).toEqual(["tasks-item"]);
  });

  it.each([
    ["calendars", CALENDARS_DOMAIN],
    ["contacts", CONTACTS_DOMAIN],
    ["notes", NOTES_DOMAIN],
    ["tasks", TASKS_DOMAIN],
  ] as const)(
    "treats a %s JMAP notFound row with lastStatus 404 as permanent",
    async (_label, domain) => {
      const id = `${domain}-jmap-missing`;
      await failRow(id, domain, `JMAP set update failed for ${id}: notFound`, 404);

      const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
      const row = await db.outbox.get(id);
      expect(isPermanentlyFailedOutboxRow(row!)).toBe(true);
      expect(isRetryableOutboxRow(row!)).toBe(false);
    },
  );

  it("leaves a drive row transient when lastError only contains 404", async () => {
    await failRow("drive-path", "drive", "could not write notes/404.md");

    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    const row = await db.outbox.get("drive-path");
    expect(row?.lastStatus).toBeUndefined();
    expect(isRetryableOutboxRow(row!)).toBe(true);
    expect(isPermanentlyFailedOutboxRow(row!)).toBe(false);
  });
});
