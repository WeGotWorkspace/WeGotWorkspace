import type { Note } from "@/lib/models/note";
import type { CollectionShareWith } from "@/share-ui/collection-share";

/** Group-membership notebook shown under My notebooks (owned via group, not isSharee). */
export type NotesSharedNotebook = {
  path: string;
  notebook: string;
  owner: string;
  scope: "personal" | "group";
  groupSlug: string | null;
  access?: string;
};

/** Collection-sidebar notebook (owned or inbound share). */
export type NotesNotebookCollection = {
  id: string;
  name: string;
  color?: string | null;
  isSharee?: boolean;
  isDefault?: boolean;
  /** API role — `"general"` is the personal default; `"group"` is the provisioned group home. */
  role?: string | null;
  scope?: "personal" | "group";
  groupSlug?: string | null;
  shareWith?: CollectionShareWith | null;
  myRights?: {
    mayWriteAll?: boolean;
    mayShare?: boolean;
    mayReadItems?: boolean;
    mayDelete?: boolean;
  } | null;
};

export type NotesDirectoryGroup = {
  slug: string;
  displayName: string;
};

export type NotesUIData = {
  notes: Note[];
  /** Owned personal notebook names only (not group notebooks). */
  notebooks: string[];
  tags: string[];
  /** Group-membership notebooks (legacy path-shaped; partition as owned). */
  sharedNotebooks?: NotesSharedNotebook[];
  /** Collection rows for `@/collection-sidebar` partition + share. */
  notebookCollections?: NotesNotebookCollection[];
  /** Directory groups for notebook owner transfer (same source as Tasks/Calendar). */
  groups?: NotesDirectoryGroup[];
};

export type DeleteNotebookAction =
  | { kind: "move"; target: string }
  | { kind: "archive" }
  | { kind: "purge" };

/**
 * Backend-agnostic notes operations consumed by notes UI/controller.
 * Implement this for any provider (WGW, custom API, local-only, etc).
 */
export type NotesAPIOperations = {
  upsertNote: (note: Note, opts?: { signal?: AbortSignal }) => Promise<Note>;
  deleteNote: (
    note: Pick<Note, "id" | "notebook" | "archived" | "groupSlug" | "scope">,
    opts?: { signal?: AbortSignal },
  ) => Promise<void>;
  archiveNote: (id: string, opts?: { signal?: AbortSignal }) => Promise<Note>;
  restoreNote: (id: string, opts?: { signal?: AbortSignal }) => Promise<Note>;
  createNotebook: (
    name: string,
    opts?: { signal?: AbortSignal; color?: string | null; groupSlug?: string | null },
  ) => Promise<NotesNotebookCollection>;
  patchNotebook?: (
    notebookId: string,
    patch: {
      name?: string;
      color?: string | null;
      groupSlug?: string | null;
      shareWith?: CollectionShareWith | null;
    },
    opts?: { signal?: AbortSignal },
  ) => Promise<NotesNotebookCollection>;
  renameNotebook: (from: string, to: string, opts?: { signal?: AbortSignal }) => Promise<void>;
  deleteNotebook: (
    name: string,
    action: DeleteNotebookAction,
    opts?: { signal?: AbortSignal },
  ) => Promise<void>;
};
