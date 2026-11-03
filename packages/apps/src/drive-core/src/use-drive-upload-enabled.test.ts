import { describe, expect, it } from "vitest";
import { isDriveUploadEnabled } from "@/drive-core/src/use-drive-mutations";

describe("isDriveUploadEnabled", () => {
  it("allows signed-in members", () => {
    expect(isDriveUploadEnabled("user", false)).toBe(true);
  });

  it("blocks a guest role", () => {
    expect(isDriveUploadEnabled("guest", false)).toBe(false);
  });

  it("blocks a guest session whose drive data still has a member-shaped user", () => {
    expect(isDriveUploadEnabled("user", true)).toBe(false);
  });
});
