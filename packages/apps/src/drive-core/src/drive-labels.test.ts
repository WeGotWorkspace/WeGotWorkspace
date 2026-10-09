import { describe, expect, it } from "vitest";
import { driveLabels } from "@/drive-core/src/drive-labels";

describe("driveLabels", () => {
  it("reserves document wording for the Docs editor", () => {
    expect(driveLabels.newMarkdown).toBe("New document");
    expect(driveLabels.createMarkdownDialogTitle).toBe("New document");
  });

  it("labels Shared with me and My Drives from the shared files-browser SST", () => {
    expect(driveLabels.sidebarHome).toBe("My Files");
    expect(driveLabels.sidebarMyDrive).toBe("Personal");
    expect(driveLabels.sidebarSharedWithMe).toBe("Shared with me");
    expect(driveLabels.sidebarSharedDrives).toBe("My Drives");
    expect(driveLabels.sharedBy("hana")).toBe("Shared by hana");
  });
});
