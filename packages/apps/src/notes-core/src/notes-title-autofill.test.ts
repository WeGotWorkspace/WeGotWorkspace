import { describe, expect, it } from "vitest";
import {
  autofillNoteTitle,
  shouldAutofillNoteTitle,
  titleFromNoteMarkdown,
} from "@/notes-core/src/notes-title-autofill";

describe("notes title autofill", () => {
  it("takes the first heading", () => {
    expect(titleFromNoteMarkdown("# Hello\n\nbody")).toBe("Hello");
  });

  it("falls back to the first non-empty line", () => {
    expect(titleFromNoteMarkdown("\n\nMeeting notes\nmore")).toBe("Meeting notes");
  });

  it("fills only when SUMMARY is empty; user edits stick", () => {
    expect(shouldAutofillNoteTitle(null)).toBe(true);
    expect(shouldAutofillNoteTitle("")).toBe(true);
    expect(shouldAutofillNoteTitle("Kept")).toBe(false);
    expect(autofillNoteTitle("Kept", "# Other")).toBe("Kept");
    expect(autofillNoteTitle("", "# Other")).toBe("Other");
  });
});
