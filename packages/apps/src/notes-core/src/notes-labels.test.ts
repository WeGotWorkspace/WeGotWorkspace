import { describe, expect, it } from "vitest";
import { defaultNotesLabels, notesNotebookDialogLabelsFrom } from "@/notes-core/src/notes-labels";

describe("notes create-collection labels", () => {
  it("matches Tasks/Calendar overflow copy for create notebook", () => {
    expect(defaultNotesLabels.addNotebook).toBe("Create notebook");
    expect(defaultNotesLabels.newNoteMenu).toBe("More create options");
    expect(defaultNotesLabels.newNotebookTitle).toBe("New notebook");
  });

  it("matches Tasks/Calendar owned vs shared section headings", () => {
    expect(defaultNotesLabels.sectionNotebooks).toBe("My notebooks");
    expect(defaultNotesLabels.sidebarSharedWithMe).toBe("Shared with me");
    expect(defaultNotesLabels.sectionSharedNotebooks).toBe("Shared with me");
  });
});

describe("notes item collection copy", () => {
  it("uses items for list counts and empty states", () => {
    expect(defaultNotesLabels.sidebarAllItems).toBe("All Items");
    expect(defaultNotesLabels.listItems(1)).toBe("1 Items");
    expect(defaultNotesLabels.listItems(3)).toBe("3 Items");
    expect(defaultNotesLabels.emptyList).toBe("No items");
    expect(defaultNotesLabels.dialogDeleteItemsTitle(1)).toBe("Delete 1 item?");
    expect(defaultNotesLabels.dialogDeleteItemsTitle(2)).toBe("Delete 2 items?");
  });
});

describe("notesNotebookDialogLabelsFrom", () => {
  it("maps notebook copy onto the shared collection dialog", () => {
    const labels = notesNotebookDialogLabelsFrom(defaultNotesLabels);
    expect(labels.createTitle).toBe("New notebook");
    expect(labels.editTitle).toBe("Edit notebook");
    expect(labels.shareListSectionTitle).toBe(defaultNotesLabels.shareNotebookTitle);
    expect(labels.deleteList).toBe("Delete notebook");
    expect(labels.deleteListConfirmTitle).toBe("Delete notebook?");
    expect(labels.delete).toBe(defaultNotesLabels.dialogDelete);
  });
});
