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
  removeNoteFromCache,
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
    await writeNotesBootstrapToCache(username, bootstrap);
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

  it("clears pendingSync after online create; hydrate does not set it true again", async () => {
    let resolveCreate!: (note: Note) => void;
    const operations = mockOperations(async (note) => {
      const saved = await new Promise<Note>((resolve) => {
        resolveCreate = resolve;
      });
      await removeNoteFromCache(username, note.id);
      await upsertNoteInCache(username, saved, false);
      return saved;
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
    expect(createdId).toMatch(/^local-/);

    await waitFor(async () => {
      expect((await noteRow(createdId))?.pendingSync).toBe(true);
    });

    await act(async () => {
      resolveCreate({ ...syncedNote, excerpt: "", body: [""], wordCount: 0 });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.activeId).toBe(syncedNote.id);
    });
    await waitFor(async () => {
      expect(await noteRow(createdId)).toBeUndefined();
      expect((await noteRow(syncedNote.id))?.pendingSync).toBe(false);
    });

    act(() => {
      result.current.applyLocalBodyMarkdown(createdId, "Hydrated after create", {
        bumpDate: false,
      });
    });

    await waitFor(async () => {
      const server = await noteRow(syncedNote.id);
      expect(JSON.parse(server?.data ?? "{}").body[0]).toContain("Hydrated after create");
    });
    expect((await noteRow(syncedNote.id))?.pendingSync).toBe(false);
    expect(await noteRow(createdId)).toBeUndefined();
    expect(await listPendingNoteIds(username)).toEqual([]);
  });

  it("does not re-insert a remapped local-* row or leave that id pending", async () => {
    let resolveCreate!: (note: Note) => void;
    const operations = mockOperations(
      () =>
        new Promise<Note>((resolve) => {
          resolveCreate = resolve;
        }),
    );
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
    expect(createdId).toMatch(/^local-/);
    await waitFor(async () => expect(await noteRow(createdId)).toBeDefined());

    await act(async () => {
      resolveCreate({ ...syncedNote, excerpt: "", body: [""], wordCount: 0 });
      await Promise.resolve();
    });
    expect(result.current.activeId).toBe(syncedNote.id);

    await removeNoteFromCache(username, createdId);
    await upsertNoteInCache(
      username,
      { ...syncedNote, excerpt: "", body: [""], wordCount: 0 },
      false,
    );

    act(() => {
      result.current.applyLocalBodyMarkdown(createdId, "Hello after remap", { bumpDate: false });
    });

    await waitFor(async () => {
      const server = await noteRow(syncedNote.id);
      expect(JSON.parse(server?.data ?? "{}").body[0]).toContain("Hello after remap");
    });
    expect(await noteRow(createdId)).toBeUndefined();
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

  it("surfaces a failed create and keeps pendingSync when upsert stays on local-*", async () => {
    const operations = mockOperations(async (note) => note);
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
    expect(createdId).toMatch(/^local-/);

    await waitFor(() => {
      expect(operations.upsertNote).toHaveBeenCalled();
    });
    await waitFor(async () => {
      expect((await noteRow(createdId))?.pendingSync).toBe(true);
    });
    await waitFor(() => {
      expect(toastApi.showError).toHaveBeenCalled();
    });
    expect(result.current.activeId).toBe(createdId);
  });

  it("surfaces a thrown create and does not clear pendingSync", async () => {
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
    expect((await noteRow(createdId))?.pendingSync).toBe(true);
    expect(result.current.activeId).toBe(createdId);
  });
});
