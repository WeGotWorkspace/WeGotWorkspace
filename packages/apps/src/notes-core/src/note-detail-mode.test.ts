import { describe, expect, it } from "vitest";
import { noteDetailMode } from "@/notes-core/src/note-detail-mode";

describe("noteDetailMode", () => {
  it("is open when the one selected row is the open note", () => {
    expect(noteDetailMode(["a"], "a")).toBe("open");
  });

  it("is opening, not empty, while a clicked row waits for its note to open", () => {
    // The row is selected at once; the open note follows in a transition.
    expect(noteDetailMode(["b"], "a")).toBe("opening");
  });

  it("is empty without a single selection, whatever note is still open", () => {
    expect(noteDetailMode([], "a")).toBe("empty");
    expect(noteDetailMode(["a", "b"], "a")).toBe("empty");
  });

  it("is empty when no note is open", () => {
    expect(noteDetailMode(["a"], null)).toBe("empty");
    expect(noteDetailMode(["a"], undefined)).toBe("empty");
    expect(noteDetailMode(["a"], "")).toBe("empty");
  });
});
