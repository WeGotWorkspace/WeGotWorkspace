import { beforeEach, describe, expect, it, vi } from "vitest";
import { JmapNotesAdapter } from "./JmapNotesAdapter";
import { JmapMethodError } from "../core/errors.js";
import type { JmapClient } from "../core/JmapClient.js";
import { NOTES_CAPABILITY } from "../core/types.js";

const getNotebooks = vi.fn();
const getNotes = vi.fn();
const notebookChanges = vi.fn();
const noteChanges = vi.fn();

vi.mock("../notes/JmapNotesClient.js", () => ({
  JmapNotesClient: class {
    getNotebooks = getNotebooks;
    getNotes = getNotes;
    notebookChanges = notebookChanges;
    noteChanges = noteChanges;
  },
}));

function clientStub(states: Record<string, string> = {}): JmapClient {
  const map = new Map(Object.entries(states));
  return {
    isConnected: true,
    connect: vi.fn(),
    primaryAccountId: (cap: string) => {
      expect(cap).toBe(NOTES_CAPABILITY);
      return "bob";
    },
    getState: (_account: string, type: string) => map.get(type),
    setState: (account: string, type: string, state: string) => {
      map.set(type, state);
      void account;
    },
  } as unknown as JmapClient;
}

describe("JmapNotesAdapter", () => {
  beforeEach(() => {
    getNotebooks.mockReset();
    getNotes.mockReset();
    notebookChanges.mockReset();
    noteChanges.mockReset();
    getNotebooks.mockResolvedValue({ list: [{ id: "notes-general", name: "General" }], state: "nb-1" });
    getNotes.mockResolvedValue({ list: [{ id: "n-1", notebookId: "notes-general", title: "Hi" }], state: "n-1" });
  });

  it("primes envelope state with empty ids so bootstrap is not re-listed", async () => {
    const onRemoteNote = vi.fn();
    const adapter = new JmapNotesAdapter({
      client: clientStub(),
      onRemoteNote,
    });
    await adapter.initialize();
    expect(getNotebooks).toHaveBeenCalledWith("bob", []);
    expect(getNotes).toHaveBeenCalledWith("bob", []);
    expect(onRemoteNote).not.toHaveBeenCalled();
  });

  it("fetches only changed note ids on sync", async () => {
    const onRemoteNote = vi.fn();
    const onRemoteNoteDestroyed = vi.fn();
    const adapter = new JmapNotesAdapter({
      client: clientStub({ Notebook: "nb-1", Note: "n-1" }),
      onRemoteNote,
      onRemoteNoteDestroyed,
    });
    notebookChanges.mockResolvedValue({ created: [], updated: [], destroyed: [], newState: "nb-2" });
    noteChanges.mockResolvedValue({
      created: ["n-2"],
      updated: [],
      destroyed: ["n-gone"],
      newState: "n-2",
    });
    getNotes.mockResolvedValue({ list: [{ id: "n-2", title: "New" }], state: "n-2" });

    await adapter.sync();

    expect(noteChanges).toHaveBeenCalledWith("bob", "n-1");
    expect(getNotes).toHaveBeenCalledWith("bob", ["n-2"]);
    expect(onRemoteNote).toHaveBeenCalledWith({ id: "n-2", title: "New" });
    expect(onRemoteNoteDestroyed).toHaveBeenCalledWith("n-gone");
  });

  it("re-primes on cannotCalculateChanges", async () => {
    const adapter = new JmapNotesAdapter({
      client: clientStub({ Note: "stale" }),
    });
    noteChanges.mockRejectedValue(
      new JmapMethodError("Note/changes", "c0", { type: "cannotCalculateChanges" }),
    );
    await adapter.sync();
    expect(getNotebooks).toHaveBeenCalled();
    expect(getNotes).toHaveBeenCalled();
  });

  it("does not destroy a note that is also created or updated in the same delta", async () => {
    const onRemoteNote = vi.fn();
    const onRemoteNoteDestroyed = vi.fn();
    const adapter = new JmapNotesAdapter({
      client: clientStub({ Notebook: "nb-1", Note: "n-1" }),
      onRemoteNote,
      onRemoteNoteDestroyed,
    });
    notebookChanges.mockResolvedValue({ created: [], updated: [], destroyed: [], newState: "nb-2" });
    noteChanges.mockResolvedValue({
      created: ["n-moved"],
      updated: [],
      destroyed: ["n-moved"],
      newState: "n-2",
    });
    getNotes.mockResolvedValue({
      list: [{ id: "n-moved", notebookId: "notes-work", title: "Moved" }],
      state: "n-2",
    });

    await adapter.sync();

    expect(onRemoteNote).toHaveBeenCalledWith(
      expect.objectContaining({ id: "n-moved", notebookId: "notes-work" }),
    );
    expect(onRemoteNoteDestroyed).not.toHaveBeenCalled();
  });

  it("hands a full snapshot to onRefetchAll after cannotCalculateChanges", async () => {
    const onRefetchAll = vi.fn();
    const adapter = new JmapNotesAdapter({
      client: clientStub({ Note: "stale" }),
      onRefetchAll,
    });
    noteChanges.mockRejectedValue(
      new JmapMethodError("Note/changes", "c0", { type: "cannotCalculateChanges" }),
    );
    await adapter.sync();
    expect(onRefetchAll).toHaveBeenCalledWith({
      notebooks: [{ id: "notes-general", name: "General" }],
      notes: [{ id: "n-1", notebookId: "notes-general", title: "Hi" }],
    });
  });
});
