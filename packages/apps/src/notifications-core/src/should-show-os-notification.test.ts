import { describe, expect, it } from "vitest";
import { shouldShowOsNotification } from "./should-show-os-notification";

describe("shouldShowOsNotification", () => {
  it("suppresses the OS banner when the tab is visible", () => {
    expect(shouldShowOsNotification("visible", "granted")).toBe(false);
  });

  it("shows the OS banner when the tab is hidden and permission is granted", () => {
    expect(shouldShowOsNotification("hidden", "granted")).toBe(true);
    expect(shouldShowOsNotification("hidden", "denied")).toBe(false);
    expect(shouldShowOsNotification("hidden", "default")).toBe(false);
  });
});
