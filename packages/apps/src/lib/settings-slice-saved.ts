export type SettingsSliceSavedEvent = {
  panelId: string;
  sliceId: string;
};

type SettingsSliceSavedListener = (event: SettingsSliceSavedEvent) => void;

const listeners = new Set<SettingsSliceSavedListener>();

/**
 * Same-tab writes call {@link notifySettingsSliceSaved}. Other tabs get a
 * `storage` event; this map re-emits those into the bus so hooks subscribe once.
 * Keys match `CALENDAR_DISPLAY_PREFS_STORAGE_KEY` and
 * `DEFAULT_COLLECTION_STORAGE_KEYS` (keep in sync).
 */
const STORAGE_SLICE_BY_KEY: Record<string, SettingsSliceSavedEvent> = {
  "wgw.ui.calendar.displayPrefs": { panelId: "calendar", sliceId: "calendar-display" },
  "wgw.ui.tasks.defaultCollection": { panelId: "tasks", sliceId: "tasks-default-collection" },
  "wgw.ui.contacts.defaultCollection": {
    panelId: "contacts",
    sliceId: "contacts-default-collection",
  },
  "wgw.ui.notes.defaultCollection": { panelId: "notes", sliceId: "notes-default-collection" },
};

let storageBound = false;

function onStorage(event: Event): void {
  const key = "key" in event ? (event as StorageEvent).key : null;
  if (!key) return;
  const mapped = STORAGE_SLICE_BY_KEY[key];
  if (mapped) notifySettingsSliceSaved(mapped);
}

function ensureSettingsSliceStorageBridge(): void {
  if (storageBound || typeof window === "undefined") return;
  storageBound = true;
  window.addEventListener("storage", onStorage);
}

export function notifySettingsSliceSaved(event: SettingsSliceSavedEvent): void {
  for (const listener of listeners) {
    listener(event);
  }
}

export function subscribeSettingsSliceSaved(listener: SettingsSliceSavedListener): () => void {
  ensureSettingsSliceStorageBridge();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetSettingsSliceSavedForTests(): void {
  listeners.clear();
}
