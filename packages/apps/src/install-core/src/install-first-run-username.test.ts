import { describe, expect, it } from "vitest";

import { isInstallUsernameValid } from "@/install-core/src/install-first-run-username";

describe("isInstallUsernameValid", () => {
  it("accepts a short slug", () => {
    expect(isInstallUsernameValid("jane")).toBe(true);
    expect(isInstallUsernameValid("j")).toBe(false);
    expect(isInstallUsernameValid("jane@host")).toBe(false);
  });
});
