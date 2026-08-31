import { describe, expect, it } from "vitest";
import {
  autofillNoteTitle,
  shouldAutofillNoteTitle,
  titleFromNoteMarkdown,
} from "@/notes-core/src/notes-title-autofill";

describe("notes title autofill", () => {
  it("takes the first heading once the line is complete", () => {
    expect(titleFromNoteMarkdown("# Hello\n\nbody")).toBe("Hello");
  });

  it("falls back to the first complete non-empty line", () => {
    expect(titleFromNoteMarkdown("\n\nMeeting notes\nmore")).toBe("Meeting notes");
  });

  it("does not treat an in-progress first line as SUMMARY", () => {
    expect(titleFromNoteMarkdown("H")).toBeNull();
    expect(titleFromNoteMarkdown("Hello")).toBeNull();
    expect(titleFromNoteMarkdown("Hello\n")).toBeNull();
    expect(titleFromNoteMarkdown("Hello\n\n")).toBeNull();
    expect(titleFromNoteMarkdown("# Other")).toBeNull();
  });

  it("fills only when SUMMARY was never set; a user-blanked title sticks", () => {
    expect(shouldAutofillNoteTitle(null)).toBe(true);
    expect(shouldAutofillNoteTitle(undefined)).toBe(true);
    expect(shouldAutofillNoteTitle("")).toBe(false);
    expect(shouldAutofillNoteTitle("Kept")).toBe(false);
    expect(autofillNoteTitle("Kept", "# Other\n\nNotes")).toBe("Kept");
    expect(autofillNoteTitle("", "# Other\n\nNotes")).toBe("");
    expect(autofillNoteTitle(null, "# Other\n\nNotes")).toBe("Other");
    expect(autofillNoteTitle("Event", "Hello\n\nworld")).toBe("Event");
  });

  it("autofills a one-character first line only after it is complete", () => {
    expect(autofillNoteTitle(null, "A")).toBeNull();
    expect(autofillNoteTitle(null, "A\n\nrest")).toBe("A");
  });
});
