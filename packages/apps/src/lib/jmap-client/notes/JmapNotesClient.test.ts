import { describe, expect, it, vi } from "vitest";
import type { JmapClient } from "../core/JmapClient.js";
import { NOTES_USING, JmapNotesClient } from "./JmapNotesClient.js";

function clientStub(call: ReturnType<typeof vi.fn>): JmapClient {
  return {
    call,
    setState: vi.fn(),
  } as unknown as JmapClient;
}

describe("JmapNotesClient set", () => {
  it("sends Notebook/set with onDestroyRemoveContents", async () => {
    const call = vi.fn().mockResolvedValue({
      newState: "nb-2",
      created: { k0: { id: "notes-x", name: "X" } },
    });
    const notes = new JmapNotesClient(clientStub(call));
    await notes.setNotebooks({
      accountId: "bob",
      create: { k0: { id: "tmp", name: "X" } },
      onDestroyRemoveContents: true,
    });
    expect(call).toHaveBeenCalledWith(
      "Notebook/set",
      expect.objectContaining({ accountId: "bob", onDestroyRemoveContents: true }),
      NOTES_USING,
    );
  });

  it("sends Note/set update with notebookId", async () => {
    const call = vi.fn().mockResolvedValue({
      newState: "n-2",
      updated: { "n-1": null },
    });
    const notes = new JmapNotesClient(clientStub(call));
    await notes.setNotes({
      accountId: "bob",
      update: { "n-1": { notebookId: "notes-work" } },
    });
    expect(call).toHaveBeenCalledWith(
      "Note/set",
      expect.objectContaining({
        accountId: "bob",
        update: { "n-1": { notebookId: "notes-work" } },
      }),
      NOTES_USING,
    );
  });
});
