import { useEffect, useState } from "react";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { listTaskLists } from "@/lib/api/wgw/tasks";
import type { CalendarPickerCalendar } from "@/lib/calendar-event-calendar-picker";
import type { DefaultCollectionApp } from "@/lib/default-collection-prefs";
import { JmapNotesClient, type JmapAddressBook, type JmapNotebook } from "@/lib/jmap-client";
import { shareRightsAllowWrite } from "@/share-ui/collection-share";
import { connectedContacts } from "@/lib/api/wgw/contacts";
import { notesJmapClient } from "@/lib/api/wgw/notes-jmap";

const ADDRESS_BOOK_DOT_COLORS = [
  "#ea8c72",
  "#6366f1",
  "#f59e0b",
  "#ec4899",
  "#22c55e",
  "#3b82f6",
] as const;

function hashDotColor(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return (
    ADDRESS_BOOK_DOT_COLORS[hash % ADDRESS_BOOK_DOT_COLORS.length] ?? ADDRESS_BOOK_DOT_COLORS[0]
  );
}

function addressBookPickerName(book: { id: string; name: string; isDefault?: boolean }): string {
  if (book.isDefault === true || book.id === "default") return "Personal";
  return book.name;
}

function toAddressBookPicker(book: JmapAddressBook): CalendarPickerCalendar {
  return {
    id: book.id,
    name: addressBookPickerName(book),
    color: hashDotColor(book.id),
    mayWrite: book.myRights ? shareRightsAllowWrite(book.myRights) : true,
  };
}

export function toNotebookPicker(notebook: JmapNotebook): CalendarPickerCalendar {
  return {
    id: notebook.name,
    name: notebook.name,
    color: notebook.color ?? hashDotColor(notebook.id),
    mayWrite: notebook.myRights
      ? shareRightsAllowWrite(notebook.myRights)
      : notebook.isSharee !== true,
  };
}

/** Mock-tier writable collections — same ids as the product story bootstraps. */
export const MOCK_APP_PICKER_COLLECTIONS: Record<DefaultCollectionApp, CalendarPickerCalendar[]> = {
  tasks: [
    { id: "inbox", name: "Inbox", color: "#6366f1" },
    { id: "default", name: "Personal", color: "#6366f1" },
    { id: "work", name: "Work", color: "#f59e0b" },
  ],
  contacts: [
    { id: "default", name: "Personal", color: hashDotColor("default") },
    { id: "work", name: "Work", color: hashDotColor("work") },
  ],
  notes: [
    { id: "The Journal", name: "The Journal", color: "#14b8a6" },
    { id: "Field Observations", name: "Field Observations", color: "#0ea5e9" },
    { id: "Drafts", name: "Drafts", color: "#f59e0b" },
    { id: "Published", name: "Published", color: "#8b5cf6" },
  ],
};

async function loadLiveTasks(): Promise<CalendarPickerCalendar[]> {
  const lists = await listTaskLists();
  return lists
    .filter((list) => list.isSharee !== true)
    .map((list) => ({
      id: list.id,
      name: list.name,
      color: list.color?.trim() || hashDotColor(list.id),
      mayWrite: list.myRights?.mayWriteAll !== false,
    }));
}

async function loadLiveContacts(): Promise<CalendarPickerCalendar[]> {
  const { contacts, accountId } = await connectedContacts();
  const get = await contacts.getAddressBooks(accountId);
  return get.list.filter((book) => book.isSharee !== true).map(toAddressBookPicker);
}

async function loadLiveNotes(): Promise<CalendarPickerCalendar[]> {
  const client = notesJmapClient();
  if (!client.isConnected) await client.connect();
  const notes = new JmapNotesClient(client);
  const get = await notes.getNotebooks(client.primaryAccountId());
  return get.list.filter((notebook) => notebook.isSharee !== true).map(toNotebookPicker);
}

/** Writable-aware collection list for Settings default pickers. Does not import product cores. */
export async function loadAppPickerCollections(
  app: DefaultCollectionApp,
): Promise<CalendarPickerCalendar[]> {
  if (!wgwLiveApiEnabled()) return MOCK_APP_PICKER_COLLECTIONS[app];
  try {
    if (app === "tasks") return await loadLiveTasks();
    if (app === "contacts") return await loadLiveContacts();
    return await loadLiveNotes();
  } catch {
    return [];
  }
}

export function useAppPickerCollections(app: DefaultCollectionApp): CalendarPickerCalendar[] {
  const [collections, setCollections] = useState<CalendarPickerCalendar[]>([]);

  useEffect(() => {
    let cancelled = false;
    void loadAppPickerCollections(app).then((next) => {
      if (!cancelled) setCollections(next);
    });
    return () => {
      cancelled = true;
    };
  }, [app]);

  return collections;
}
