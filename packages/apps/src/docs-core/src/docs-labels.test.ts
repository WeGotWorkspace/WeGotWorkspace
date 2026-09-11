import { describe, expect, it } from "vitest";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { driveLabels } from "@/drive-core/src/drive-labels";

describe("docsLabels Drive SST re-exports", () => {
  it("reuses Drive chrome labels for shared home navigation and actions", () => {
    expect(docsLabels.homeSharedWithMe).toBe(driveLabels.sidebarSharedWithMe);
    expect(docsLabels.homeRecent).toBe(driveLabels.sidebarRecent);
    expect(docsLabels.homeStarred).toBe(driveLabels.sidebarStarred);
    expect(docsLabels.homeTrash).toBe(driveLabels.sidebarTrash);
    expect(docsLabels.homeNewDocument).toBe(driveLabels.newMarkdown);
    expect(docsLabels.share).toBe(driveLabels.detailShare);
    expect(docsLabels.rename).toBe(driveLabels.detailRename);
    expect(docsLabels.renameAction).toBe(driveLabels.renameAction);
    expect(docsLabels.cancel).toBe(driveLabels.cancel);
    expect(docsLabels.offlineAvailable).toBe(driveLabels.offlineAvailable);
    expect(docsLabels.offlinePendingSync).toBe(driveLabels.offlinePendingSync);
    expect(docsLabels.homeSharedBy("hana")).toBe(driveLabels.sharedBy("hana"));
  });

  it("keeps Docs-specific home and rename dialog copy", () => {
    expect(docsLabels.homeAllDocs).toBe("My Docs");
    expect(docsLabels.homeMyDrive).toBe("Personal");
    expect(docsLabels.homeDrivesSection).toBe("My Drives");
    expect(driveLabels.sidebarHome).toBe("My Files");
    expect(driveLabels.sidebarPersonalDrive).toBe(docsLabels.homeMyDrive);
    expect(driveLabels.sidebarSharedDrives).toBe(docsLabels.homeDrivesSection);
    expect(docsLabels.renameDialogTitle).toBe("Rename document");
    expect(docsLabels.homeEmpty).toContain("Markdown");
  });

  it("keeps English Suggest toggle and mode-switch toast labels for the collab header", () => {
    expect(docsLabels.editMode).toBe("Edit");
    expect(docsLabels.suggestMode).toBe("Suggest");
    expect(docsLabels.editingModeAria).toBe("Editing mode");
    expect(docsLabels.toastSwitchedToEditMode).toBe("Switched to Edit mode");
    expect(docsLabels.toastSwitchedToSuggestMode).toBe("Switched to Suggest mode");
  });

  it("keeps English last-edited footer chip clarification matching Notes", () => {
    expect(docsLabels.editedLabel).toBe("Last edited");
  });
});
