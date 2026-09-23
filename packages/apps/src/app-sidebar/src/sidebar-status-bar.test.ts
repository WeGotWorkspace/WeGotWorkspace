import { describe, expect, it } from "vitest";
import { openSidebarStatusBarColor } from "@/app-sidebar/src/sidebar-status-bar";

describe("openSidebarStatusBarColor", () => {
  it("uses the sidebar fill while the overlay drawer is open", () => {
    expect(openSidebarStatusBarColor(true, true, "rgb(255, 245, 233)")).toBe("rgb(255, 245, 233)");
  });

  it("leaves the document color alone when the drawer is closed or docked", () => {
    expect(openSidebarStatusBarColor(false, true, "rgb(255, 245, 233)")).toBeNull();
    expect(openSidebarStatusBarColor(true, false, "rgb(255, 245, 233)")).toBeNull();
  });

  it("ignores an empty or transparent sidebar fill", () => {
    expect(openSidebarStatusBarColor(true, true, "transparent")).toBeNull();
    expect(openSidebarStatusBarColor(true, true, "  ")).toBeNull();
  });
});
