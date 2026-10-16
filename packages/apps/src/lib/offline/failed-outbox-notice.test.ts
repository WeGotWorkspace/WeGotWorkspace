/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { listFailedCalendarOutbox } from "@/lib/offline/calendars-offline-store";
import { CALENDARS_DOMAIN } from "@/lib/offline/calendars/calendars-schema";
import { listFailedContactOutbox } from "@/lib/offline/contacts-offline-store";
import { CONTACTS_DOMAIN } from "@/lib/offline/contacts/contacts-schema";
import { enqueueOutboxMutation, markOutboxError } from "@/lib/offline/core/outbox-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { listFailedNotesOutbox } from "@/lib/offline/notes-offline-store";
import { NOTES_DOMAIN } from "@/lib/offline/notes/notes-schema";
import { listFailedTaskOutbox } from "@/lib/offline/tasks-offline-store";
import { TASKS_DOMAIN } from "@/lib/offline/tasks/tasks-schema";

const username = "alice";

const lists = [
  ["calendars", CALENDARS_DOMAIN, listFailedCalendarOutbox],
  ["contacts", CONTACTS_DOMAIN, listFailedContactOutbox],
  ["notes", NOTES_DOMAIN, listFailedNotesOutbox],
  ["tasks", TASKS_DOMAIN, listFailedTaskOutbox],
] as const;

describe("domain failed outbox notices", () => {
  beforeEach(async () => {
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
  });

  it.each(lists)("keeps a 404 %s outbox row visible", async (_label, domain, listFailed) => {
    await enqueueOutboxMutation(username, {
      id: `${domain}-404`,
      domain,
      op: "update",
      payload: "{}",
    });
    await markOutboxError(username, `${domain}-404`, "GET failed (404)");

    const rows = await listFailed(username);
    expect(rows.map((row) => row.id)).toEqual([`${domain}-404`]);
  });
});
