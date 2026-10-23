import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import type { Note } from "@/lib/models/note";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  readOfflineNotesUsername,
  rememberOfflineNotesUsername,
} from "@/lib/offline/offline-session";
import { notesNotesTable } from "@/lib/offline/notes/notes-schema";
import {
  listPendingNoteIds,
  upsertNoteInCache,
  writeNotesBootstrapToCache,
} from "@/lib/offline/notes-offline-store";
import type { NotesUIData } from "./notes-types";
import { useNotesController } from "./use-notes-controller";

const toastApi = {
  show: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn(),
  dismiss: vi.fn(),
};

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => toastApi,
}));

vi.mock("@/hooks/use-confirm-dialog", () => ({
  useConfirmDialog: () => ({
    confirmDialog: null,
    requestConfirm: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-is-touch", () => ({
  useIsTouch: () => false,
}));

const username = "bob";

const syncedNote: Note = {
  id: "11111111-2222-3333-4444-555555555555",
  category: "Note",
  date: "2024-10-12T10:00:00.000Z",
  excerpt: "Synced excerpt",
  body: ["Synced body"],
  notebook: "Drafts",
  tags: [],
  wordCount: 2,
};

const bootstrap = {
  session: mockWorkspaceSession,
  data: {
    notes: [syncedNote],
    notebooks: ["Drafts"],
    tags: [],
  },
} satisfies ReturnType<typeof createNotesAppBootstrap>;

function mockOperations(upsert = async (note: Note) => note) {
  return {
    upsertNote: vi.fn(upsert),
    deleteNote: vi.fn(),
    archiveNote: vi.fn(),
    restoreNote: vi.fn(),
    createNotebook: vi.fn(),
    renameNotebook: vi.fn(),
    deleteNotebook: vi.fn(),
  };
}

async function noteRow(id: string) {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  return notesNotesTable(db).get(id);
}

describe("applyLocalBodyMarkdown Dexie pendingSync", () => {
  beforeEach(async () => {
    toastApi.show.mockReset();
    toastApi.showError.mockReset();
    rememberOfflineNotesUsername(username);
    await writeNotesBootstrapToCache(username, bootstrap, Date.now());
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("does not set pendingSync when hydrating a synced note", async () => {
    await upsertNoteInCache(username, syncedNote, false);
    const data: NotesUIData = {
      notes: [syncedNote],
      notebooks: ["Drafts"],
      tags: [],
    };
    const { result } = renderHook(() =>
      useNotesController({ data, listLoading: false, operations: mockOperations() }),
    );

    expect(readOfflineNotesUsername()).toBe(username);
    expect(result.current.notes.map((note) => note.id)).toContain(syncedNote.id);

    act(() => {
      result.current.applyLocalBodyMarkdown(syncedNote.id, "Hydrated body", { bumpDate: false });
    });

    expect(result.current.notes.find((note) => note.id === syncedNote.id)?.body[0]).toContain(
      "Hydrated body",
    );

    await waitFor(async () => {
      const row = await noteRow(syncedNote.id);
      expect(JSON.parse(row?.data ?? "{}").body[0]).toContain("Hydrated body");
    });
    expect((await noteRow(syncedNote.id))?.pendingSync).toBe(false);
    expect(await listPendingNoteIds(username)).toEqual([]);
  });

  it("keeps a metadata-pending note pending after a body preview write", async () => {
    await upsertNoteInCache(username, syncedNote, true);
    const data: NotesUIData = {
      notes: [syncedNote],
      notebooks: ["Drafts"],
      tags: [],
    };
    const { result } = renderHook(() =>
      useNotesController({ data, listLoading: false, operations: mockOperations() }),
    );

    act(() => {
      result.current.applyLocalBodyMarkdown(syncedNote.id, "Typed while offline");
    });

    await waitFor(async () => {
      expect(await listPendingNoteIds(username)).toEqual([syncedNote.id]);
    });
    expect((await noteRow(syncedNote.id))?.pendingSync).toBe(true);
  });

  it("surfaces a thrown create and keeps the new note open", async () => {
    const operations = mockOperations(async () => {
      throw Object.assign(new Error("no such table"), { status: 500 });
    });
    const data: NotesUIData = {
      notes: [],
      notebooks: ["Drafts"],
      tags: [],
    };
    const { result } = renderHook(() =>
      useNotesController({ data, listLoading: false, operations }),
    );

    act(() => {
      result.current.createNote();
    });
    const createdId = result.current.activeId;

    await waitFor(() => {
      expect(toastApi.showError).toHaveBeenCalled();
    });
    expect(result.current.activeId).toBe(createdId);
  });
});
