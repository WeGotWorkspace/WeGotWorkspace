import { describe, expect, it } from "vitest";
import { driveLabels, driveOfficeNewFileLabel } from "@/drive-core/src/drive-labels";

describe("driveOfficeNewFileLabel", () => {
  it("uses extension-style labels for Office blanks", () => {
    expect(driveOfficeNewFileLabel("doc")).toBe("New docx");
    expect(driveOfficeNewFileLabel("sheet")).toBe("New xlsx");
    expect(driveOfficeNewFileLabel("slides")).toBe("New pptx");
  });
});

describe("driveLabels", () => {
  it("reserves document wording for the Docs editor", () => {
    expect(driveLabels.newMarkdown).toBe("New document");
    expect(driveLabels.createMarkdownDialogTitle).toBe("New document");
  });

  it("labels Shared with me and My Drives from the shared files-browser SST", () => {
    expect(driveLabels.sidebarHome).toBe("My Files");
    expect(driveLabels.sidebarMyDrive).toBe("My Drive");
    expect(driveLabels.sidebarPersonalDrive).toBe("Personal");
    expect(driveLabels.sidebarSharedWithMe).toBe("Shared with me");
    expect(driveLabels.sidebarSharedDrives).toBe("My Drives");
    expect(driveLabels.sharedBy("hana")).toBe("Shared by hana");
  });
});
