import { describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
import type { NotesAPIOperations } from "@/notes-core/src/notes-types";
import { notifyOtherTabsOnStructuralChanges } from "./notes-cross-tab-notify";

vi.mock("@/lib/offline/notes-bootstrap-sync", () => ({
  notifyNotesBootstrapUpdated: vi.fn(),
}));

import { notifyNotesBootstrapUpdated } from "@/lib/offline/notes-bootstrap-sync";

const saved = { id: "n1" } as Note;

function operations(overrides: Partial<NotesAPIOperations> = {}): NotesAPIOperations {
  return {
    upsertNote: vi.fn(async (note: Note) => note),
    deleteNote: vi.fn(async () => undefined),
    archiveNote: vi.fn(async () => saved),
    restoreNote: vi.fn(async () => saved),
    createNotebook: vi.fn(),
    renameNotebook: vi.fn(),
    deleteNotebook: vi.fn(),
    ...overrides,
  } as NotesAPIOperations;
}

describe("notifyOtherTabsOnStructuralChanges", () => {
  it("tells other tabs after an archive, restore, or delete", async () => {
    vi.mocked(notifyNotesBootstrapUpdated).mockClear();
    const ops = notifyOtherTabsOnStructuralChanges("member", operations());

    await ops.archiveNote("n1");
    await ops.restoreNote("n1");
    await ops.deleteNote({ id: "n1", notebook: "General" });

    expect(notifyNotesBootstrapUpdated).toHaveBeenCalledTimes(3);
    expect(notifyNotesBootstrapUpdated).toHaveBeenCalledWith("member");
  });

  it("stays quiet for metadata saves and failed changes", async () => {
    vi.mocked(notifyNotesBootstrapUpdated).mockClear();
    const ops = notifyOtherTabsOnStructuralChanges(
      "member",
      operations({ archiveNote: vi.fn(async () => Promise.reject(new Error("refused"))) }),
    );

    await ops.upsertNote(saved);
    await expect(ops.archiveNote("n1")).rejects.toThrow("refused");

    expect(notifyNotesBootstrapUpdated).not.toHaveBeenCalled();
  });
});
