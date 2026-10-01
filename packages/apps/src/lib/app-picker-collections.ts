import { useEffect, useState } from "react";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { listTaskLists } from "@/lib/api/wgw/tasks";
import type { CalendarPickerCalendar } from "@/lib/calendar-event-calendar-picker";
import { readDefaultCollectionId, type DefaultCollectionApp } from "@/lib/default-collection-prefs";
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
    isDefault: book.isDefault ?? book.id === "default",
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
    isDefault: notebook.isDefault ?? notebook.role === "general",
  };
}

/** Mock-tier writable collections — same ids as the product story bootstraps. */
export const MOCK_APP_PICKER_COLLECTIONS: Record<DefaultCollectionApp, CalendarPickerCalendar[]> = {
  tasks: [
    { id: "inbox", name: "Inbox", color: "#6366f1", isDefault: true },
    { id: "default", name: "Personal", color: "#6366f1" },
    { id: "work", name: "Work", color: "#f59e0b" },
  ],
  contacts: [
    { id: "default", name: "Personal", color: hashDotColor("default"), isDefault: true },
    { id: "work", name: "Work", color: hashDotColor("work") },
  ],
  notes: [
    { id: "The Journal", name: "The Journal", color: "#14b8a6", isDefault: true },
    { id: "Field Observations", name: "Field Observations", color: "#0ea5e9" },
    { id: "Drafts", name: "Drafts", color: "#f59e0b" },
    { id: "Published", name: "Published", color: "#8b5cf6" },
  ],
};

function taskListIsDefault(list: { id: string; isDefault?: boolean | null }): boolean {
  return list.isDefault ?? (list.id === "inbox" || list.id === "tasks-inbox");
}

/**
 * Shown before the live list returns when the user has no saved id, or the
 * saved id is already this row. Any other saved id stays hidden until the list loads.
 */
const LIVE_APP_PICKER_DEFAULT: Record<DefaultCollectionApp, CalendarPickerCalendar> = {
  tasks: { id: "tasks-inbox", name: "Inbox", color: "#6366f1", isDefault: true },
  contacts: {
    id: "default",
    name: "Personal",
    color: hashDotColor("default"),
    isDefault: true,
  },
  notes: { id: "General", name: "General", color: "#14b8a6", isDefault: true },
};

export function initialAppPickerCollections(app: DefaultCollectionApp): CalendarPickerCalendar[] {
  if (!wgwLiveApiEnabled()) return MOCK_APP_PICKER_COLLECTIONS[app];
  const seed = LIVE_APP_PICKER_DEFAULT[app];
  const savedId = readDefaultCollectionId(app);
  if (savedId && savedId !== seed.id) return [];
  return [seed];
}

async function loadLiveTasks(): Promise<CalendarPickerCalendar[]> {
  const lists = await listTaskLists();
  return lists
    .filter((list) => list.isSharee !== true)
    .map((list) => ({
      id: list.id,
      name: list.name,
      color: list.color?.trim() || hashDotColor(list.id),
      mayWrite: list.myRights?.mayWriteAll !== false,
      isDefault: taskListIsDefault(list),
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

export type AppPickerCollectionsState = {
  collections: CalendarPickerCalendar[];
  /** False while a live list is still in flight. Mock mode is loaded immediately. */
  loaded: boolean;
};

export function useAppPickerCollections(app: DefaultCollectionApp): AppPickerCollectionsState {
  const [collections, setCollections] = useState(() => initialAppPickerCollections(app));
  const [loaded, setLoaded] = useState(() => !wgwLiveApiEnabled());

  useEffect(() => {
    let cancelled = false;
    if (wgwLiveApiEnabled()) {
      setCollections(initialAppPickerCollections(app));
      setLoaded(false);
    }
    void loadAppPickerCollections(app).then((next) => {
      if (cancelled) return;
      setCollections(next);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [app]);

  return { collections, loaded };
}
