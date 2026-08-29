import { describe, expect, it } from "vitest";
import { defaultNotesLabels, notesNotebookDialogLabelsFrom } from "@/notes-core/src/notes-labels";

describe("notes create-collection labels", () => {
  it("matches Tasks/Calendar overflow copy for create notebook", () => {
    expect(defaultNotesLabels.addNotebook).toBe("Create notebook");
    expect(defaultNotesLabels.newNoteMenu).toBe("More create options");
    expect(defaultNotesLabels.newNotebookTitle).toBe("New notebook");
  });
});

describe("notesNotebookDialogLabelsFrom", () => {
  it("maps notebook copy onto the shared collection dialog", () => {
    const labels = notesNotebookDialogLabelsFrom(defaultNotesLabels);
    expect(labels.createTitle).toBe("New notebook");
    expect(labels.editTitle).toBe("Edit notebook");
    expect(labels.shareListSectionTitle).toBe(defaultNotesLabels.shareNotebookTitle);
  });
});
