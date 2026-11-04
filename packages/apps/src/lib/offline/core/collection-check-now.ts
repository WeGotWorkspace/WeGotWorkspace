import { sendMeshCheckNow } from "@/lib/jmap-client/push/mesh-check-now";
import {
  calendarsCalendarsTable,
  calendarsEventsTable,
} from "@/lib/offline/calendars/calendars-schema";
import { contactsBooksTable, contactsCardsTable } from "@/lib/offline/contacts/contacts-schema";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { notesNotebooksTable, notesNotesTable } from "@/lib/offline/notes/notes-schema";
import {
  readOfflineCalendarsUsername,
  readOfflineContactsUsername,
  readOfflineNotesUsername,
  readOfflineTasksUsername,
} from "@/lib/offline/offline-session";
import { tasksItemsTable, tasksListsTable } from "@/lib/offline/tasks/tasks-schema";
import { isShareGroupId, type CollectionShareWith } from "@/share-ui/collection-share";

/**
 * Silent news over the mesh (#1662): after a write to a collection, nudge the
 * users this browser knows share it. That is the collection's `shareWith`
 * user grants, which the server only sends to whoever may share it (the
 * owner). Group grants and group-owned collections have no member list on
 * the client, and a sharee sees no `shareWith`: then nobody is nudged, and
 * the event source brings the change within its retry.
 */
export type CheckNowDomain = "notes" | "tasks" | "calendars" | "contacts";

/** Usernames with a user grant in `shareWith`; group grants are skipped. */
export function shareWithAudience(shareWith: CollectionShareWith | null | undefined): string[] {
  if (!shareWith) return [];
  return Object.entries(shareWith)
    .filter(([id, rights]) => rights != null && id.trim() !== "" && !isShareGroupId(id))
    .map(([id]) => id.trim());
}

function offlineUsername(domain: CheckNowDomain): string | null {
  switch (domain) {
    case "notes":
      return readOfflineNotesUsername();
    case "tasks":
      return readOfflineTasksUsername();
    case "calendars":
      return readOfflineCalendarsUsername();
    case "contacts":
      return readOfflineContactsUsername();
  }
}

function parseShareWith(data: string | undefined): CollectionShareWith | null {
  if (!data) return null;
  try {
    const parsed = JSON.parse(data) as { shareWith?: unknown };
    return parsed.shareWith && typeof parsed.shareWith === "object"
      ? (parsed.shareWith as CollectionShareWith)
      : null;
  } catch {
    return null;
  }
}

async function cachedShareWith(
  domain: CheckNowDomain,
  collectionId: string,
): Promise<CollectionShareWith | null> {
  const username = offlineUsername(domain);
  if (!username || !collectionId) return null;
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const table = {
    notes: notesNotebooksTable,
    tasks: tasksListsTable,
    calendars: calendarsCalendarsTable,
    contacts: contactsBooksTable,
  }[domain](db);
  return parseShareWith((await table.get(collectionId))?.data);
}

async function cachedItemCollectionId(
  domain: CheckNowDomain,
  itemId: string,
): Promise<string | null> {
  const username = offlineUsername(domain);
  if (!username || !itemId) return null;
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  switch (domain) {
    case "notes":
      return (await notesNotesTable(db).get(itemId))?.notebookId ?? null;
    case "tasks":
      return (await tasksItemsTable(db).get(itemId))?.taskListId ?? null;
    case "calendars":
      return (await calendarsEventsTable(db).get(itemId))?.calendarId ?? null;
    case "contacts":
      return (await contactsCardsTable(db).get(itemId))?.addressBookId ?? null;
  }
}

/** The audience of these collections as the local cache knows it now. Never throws. */
export async function cachedCollectionAudience(
  domain: CheckNowDomain,
  collectionIds: readonly (string | null | undefined)[],
): Promise<string[]> {
  const ids = [...new Set(collectionIds.filter((id): id is string => !!id))];
  try {
    const lists = await Promise.all(ids.map((id) => cachedShareWith(domain, id)));
    return lists.flatMap(shareWithAudience);
  } catch {
    return [];
  }
}

/** The audience of the collection holding a cached item (read it before a delete). */
export async function cachedItemAudience(
  domain: CheckNowDomain,
  itemId: string,
): Promise<string[]> {
  try {
    return await cachedCollectionAudience(domain, [await cachedItemCollectionId(domain, itemId)]);
  } catch {
    return [];
  }
}

/**
 * Fire-and-forget nudge after a successful write. Each audience is a lookup;
 * start the one for a removed or moved row before the request, while the cache
 * still has it. `extra` (a `shareWith` from the response) is added, so a
 * changed share list reaches both the old and the new sharees.
 */
export function checkNowAfterWrite(
  audiences: readonly Promise<readonly string[]>[],
  extra: CollectionShareWith | null | undefined = null,
): void {
  void Promise.all(audiences.map((audience) => audience.catch(() => [] as string[]))).then(
    (lists) => sendMeshCheckNow([...lists.flat(), ...shareWithAudience(extra)]),
  );
}
