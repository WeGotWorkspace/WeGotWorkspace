import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  onSyncConflict: undefined as ((noteIds: string[]) => void) | undefined,
  syncConflictNoteIds: undefined as readonly string[] | undefined,
  onClearSyncConflicts: undefined as (() => void) | undefined,
}));

vi.mock("@/lib/live/workspace-live-app-shell", () => ({
  WorkspaceLiveAppShell: (props: { render: () => unknown }) => props.render(),
}));

vi.mock("@/lib/offline/use-offline-sync-toast", () => ({
  useOfflineSyncToast: () => undefined,
}));

vi.mock("@/notes-core/src/use-notes-route-sync", () => ({
  useNotesRouteSync: () => ({
    initialView: "all",
    initialNoteId: undefined,
    handleViewChange: () => undefined,
    handleNoteChange: () => undefined,
  }),
}));

vi.mock("@/notes-core/src/use-notes-api", () => ({
  useNotesAPI: (_source: unknown, options?: { onSyncConflict?: (noteIds: string[]) => void }) => {
    harness.onSyncConflict = options?.onSyncConflict;
    return {
      phase: "ready",
      error: null,
      retry: () => undefined,
      successVersion: 1,
      bootstrapRevision: 0,
      syncing: false,
      listLoading: false,
      listRefreshing: false,
      refreshList: () => undefined,
      data: {},
      session: { user: { username: "bob" } },
      operations: {},
    };
  },
}));

vi.mock("@/notes-core/src/notes-workspace", () => ({
  NotesWorkspace: (props: {
    syncConflictNoteIds?: readonly string[];
    onClearSyncConflicts?: () => void;
  }) => {
    harness.syncConflictNoteIds = props.syncConflictNoteIds;
    harness.onClearSyncConflicts = props.onClearSyncConflicts;
    return null;
  },
}));

import { NotesApp } from "@/notes-core/src/notes-app";

afterEach(() => {
  cleanup();
  harness.onSyncConflict = undefined;
  harness.syncConflictNoteIds = undefined;
  harness.onClearSyncConflicts = undefined;
});

describe("NotesApp metadata sync conflicts", () => {
  it("unions reported note ids onto the workspace and clears them on retry", () => {
    render(<NotesApp />);
    expect(harness.syncConflictNoteIds).toEqual([]);

    act(() => {
      harness.onSyncConflict?.(["note-1"]);
    });
    expect(harness.syncConflictNoteIds).toEqual(["note-1"]);

    act(() => {
      harness.onSyncConflict?.(["note-1", "note-2"]);
    });
    expect(harness.syncConflictNoteIds).toEqual(["note-1", "note-2"]);

    act(() => {
      harness.onClearSyncConflicts?.();
    });
    expect(harness.syncConflictNoteIds).toEqual([]);
  });
});
