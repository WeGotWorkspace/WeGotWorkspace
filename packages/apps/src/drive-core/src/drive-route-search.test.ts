/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  driveHrefFromView,
  driveSearchFromView,
  driveViewFromSearch,
  openDriveAccessInNewWindow,
} from "@/drive-core/src/drive-route-search";

describe("drive-route-search open helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("driveHrefFromView builds a /drive?… URL from an access view", () => {
    expect(driveHrefFromView({ type: "access" })).toBe("/drive?view=access");
    expect(driveHrefFromView({ type: "access", scopePath: "My Drive/Projects" })).toBe(
      "/drive?view=access&path=My+Drive%2FProjects",
    );
    expect(driveSearchFromView({ type: "access", scopePath: "My Drive" })).toEqual({
      view: "access",
    });
  });

  it("driveViewFromSearch ignores access deep links until the manager is product-ready", () => {
    expect(driveViewFromSearch({ view: "access" })).toEqual({
      type: "folder",
      path: "My Drive",
    });
    expect(driveViewFromSearch({ view: "access", path: "My Drive/Projects" })).toEqual({
      type: "folder",
      path: "My Drive",
    });
  });

  it("openDriveAccessInNewWindow opens the access manager href in a new tab", () => {
    const popup = { closed: false } as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(popup);

    const result = openDriveAccessInNewWindow("My Drive/Projects/report.md");

    expect(result).toBe(popup);
    expect(open).toHaveBeenCalledWith(
      "/drive?view=access&path=My+Drive%2FProjects%2Freport.md",
      "_blank",
      "noopener,noreferrer",
    );
  });
});

describe("drive-route-search shared view", () => {
  it("round-trips the Shared with me view via ?view=shared", () => {
    expect(driveViewFromSearch({ view: "shared" })).toEqual({ type: "shared" });
    expect(driveSearchFromView({ type: "shared" })).toEqual({ view: "shared" });
    expect(driveHrefFromView({ type: "shared" })).toBe("/drive?view=shared");
  });
});
