import { useEffect, useState } from "react";

export const DEFAULT_COLLECTION_APPS = ["tasks", "contacts", "notes"] as const;
export type DefaultCollectionApp = (typeof DEFAULT_COLLECTION_APPS)[number];

export type DefaultCollectionPrefs = {
  collectionId?: string;
};

export const DEFAULT_COLLECTION_STORAGE_KEYS: Record<DefaultCollectionApp, string> = {
  tasks: "wgw.ui.tasks.defaultCollection",
  contacts: "wgw.ui.contacts.defaultCollection",
  notes: "wgw.ui.notes.defaultCollection",
};

export const DEFAULT_COLLECTION_CHANGED_EVENT = "wgw-default-collection-changed";

export type DefaultCollectionAppMeta = {
  label: string;
  description: string;
  fieldLabel: string;
  savedMessage: string;
  saveError: string;
};

export const DEFAULT_COLLECTION_APP_META: Record<DefaultCollectionApp, DefaultCollectionAppMeta> = {
  tasks: {
    label: "Tasks",
    description: "Default list for new tasks",
    fieldLabel: "Default list",
    savedMessage: "Tasks settings saved",
    saveError: "Could not save Tasks settings",
  },
  contacts: {
    label: "Contacts",
    description: "Default address book for new contacts",
    fieldLabel: "Default address book",
    savedMessage: "Contacts settings saved",
    saveError: "Could not save Contacts settings",
  },
  notes: {
    label: "Notes",
    description: "Default notebook for new notes",
    fieldLabel: "Default notebook",
    savedMessage: "Notes settings saved",
    saveError: "Could not save Notes settings",
  },
};

function isStoredCollectionId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseDefaultCollectionPrefs(raw: string | null): DefaultCollectionPrefs {
  if (!raw) return {};
  try {
    const record = JSON.parse(raw) as unknown;
    if (!record || typeof record !== "object") return {};
    const collectionId = (record as { collectionId?: unknown }).collectionId;
    if (!isStoredCollectionId(collectionId)) return {};
    return { collectionId: collectionId.trim() };
  } catch {
    return {};
  }
}

export function readDefaultCollectionPrefs(app: DefaultCollectionApp): DefaultCollectionPrefs {
  try {
    return parseDefaultCollectionPrefs(
      window.localStorage.getItem(DEFAULT_COLLECTION_STORAGE_KEYS[app]),
    );
  } catch {
    return {};
  }
}

export function readDefaultCollectionId(app: DefaultCollectionApp): string | undefined {
  return readDefaultCollectionPrefs(app).collectionId;
}

export function writeDefaultCollectionPrefs(
  app: DefaultCollectionApp,
  prefs: DefaultCollectionPrefs,
): void {
  try {
    const collectionId = prefs.collectionId?.trim();
    const payload: DefaultCollectionPrefs = collectionId ? { collectionId } : {};
    window.localStorage.setItem(DEFAULT_COLLECTION_STORAGE_KEYS[app], JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent(DEFAULT_COLLECTION_CHANGED_EVENT, { detail: { app } }));
  } catch {
    // quota / private mode
  }
}

export function pickPreferredCollectionId(
  ids: readonly string[],
  preferredId: string | undefined,
): string | undefined {
  if (preferredId && ids.includes(preferredId)) return preferredId;
  return undefined;
}

export function useDefaultCollectionId(app: DefaultCollectionApp): string | undefined {
  const [collectionId, setCollectionId] = useState(() => readDefaultCollectionId(app));

  useEffect(() => {
    const refresh = (event?: Event) => {
      if (
        event instanceof CustomEvent &&
        event.detail &&
        typeof event.detail === "object" &&
        "app" in event.detail &&
        event.detail.app !== app
      ) {
        return;
      }
      setCollectionId(readDefaultCollectionId(app));
    };
    window.addEventListener(DEFAULT_COLLECTION_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(DEFAULT_COLLECTION_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [app]);

  return collectionId;
}
