import type { Note } from "@/lib/models/note";

/** Notebook-dir grant or group-membership notebook shown under Shared notebooks. */
export type NotesSharedNotebook = {
  path: string;
  notebook: string;
  owner: string;
  scope: "personal" | "group";
  groupSlug: string | null;
  access?: string;
};

export type NotesUIData = {
  notes: Note[];
  /** Owned personal notebook names only (not group / ACL shared). */
  notebooks: string[];
  tags: string[];
  /** Shared notebooks section: ACL dir grants + group-scoped notebooks. */
  sharedNotebooks?: NotesSharedNotebook[];
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
    note: Pick<Note, "id" | "notebook" | "archived">,
    opts?: { signal?: AbortSignal },
  ) => Promise<void>;
  archiveNote: (id: string, opts?: { signal?: AbortSignal }) => Promise<Note>;
  restoreNote: (id: string, opts?: { signal?: AbortSignal }) => Promise<Note>;
  createNotebook: (name: string, opts?: { signal?: AbortSignal }) => Promise<void>;
  renameNotebook: (from: string, to: string, opts?: { signal?: AbortSignal }) => Promise<void>;
  deleteNotebook: (
    name: string,
    action: DeleteNotebookAction,
    opts?: { signal?: AbortSignal },
  ) => Promise<void>;
};
