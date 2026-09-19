import { describe, expect, it } from "vitest";

import {
  isInstallEmailValid,
  isInstallUsernameValid,
} from "@/install-core/src/install-first-run-username";

describe("isInstallUsernameValid", () => {
  it("accepts a short slug", () => {
    expect(isInstallUsernameValid("jane")).toBe(true);
    expect(isInstallUsernameValid("j")).toBe(false);
    expect(isInstallUsernameValid("jane@host")).toBe(false);
  });
});

describe("isInstallEmailValid", () => {
  it("requires something@something.something", () => {
    expect(isInstallEmailValid("jane@example.com")).toBe(true);
    expect(isInstallEmailValid(" jane@example.com ")).toBe(true);
    expect(isInstallEmailValid("")).toBe(false);
    expect(isInstallEmailValid("not-an-email")).toBe(false);
    expect(isInstallEmailValid("jane@localhost")).toBe(false);
  });
});
