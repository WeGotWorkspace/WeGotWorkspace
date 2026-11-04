import { describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
import type { NotesAPIOperations } from "./notes-types";
import { sendTagDelta } from "./notes-undo-writes";

const note = (id: string) => ({ id }) as Note;

describe("sendTagDelta", () => {
  it("waits for every row to settle before it rejects, and marks the late row", async () => {
    let resolveSecond!: (saved: Note) => void;
    const upsertNote = vi
      .fn()
      .mockReturnValueOnce(Promise.reject(new Error("boom")))
      .mockReturnValueOnce(new Promise<Note>((resolve) => (resolveSecond = resolve)));
    const operations = { upsertNote } as unknown as NotesAPIOperations;
    const marked: string[] = [];
    let settled = false;

    const result = sendTagDelta(
      operations,
      [note("a"), note("b")],
      { tagsAdd: ["x"] },
      vi.fn(),
      (id) => marked.push(id),
    );
    const outcome = result.then(
      () => (settled = true),
      () => (settled = true),
    );

    await new Promise((r) => setTimeout(r, 0));
    expect(settled).toBe(false);

    resolveSecond(note("b"));
    await outcome;
    await expect(result).rejects.toThrow("boom");
    expect(marked).toEqual(["b"]);
  });
});
