import { describe, expect, it } from "vitest";
import {
  FILES_BROWSER_SIDEBAR_PRIMARY_ORDER,
  filesBrowserHomeLabel,
  filesBrowserSidebarLabels,
} from "@/drive-core/src/files-browser-sidebar";

describe("filesBrowserSidebar", () => {
  it("keeps a shared primary order with product-specific home labels", () => {
    expect(FILES_BROWSER_SIDEBAR_PRIMARY_ORDER).toEqual([
      "home",
      "shared",
      "recent",
      "starred",
      "trash",
    ]);
    expect(filesBrowserHomeLabel("docs")).toBe("My Docs");
    expect(filesBrowserHomeLabel("drive")).toBe("My Files");
    expect(filesBrowserSidebarLabels.drivesSection).toBe("My Drives");
    expect(filesBrowserSidebarLabels.personalDrive).toBe("Personal");
  });
});
