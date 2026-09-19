import { describe, expect, it } from "vitest";

import {
  isInstallerEmailValid,
  isInstallerUsernameValid,
} from "@/installer-core/src/installer-username";

describe("isInstallerUsernameValid", () => {
  it("accepts a short slug", () => {
    expect(isInstallerUsernameValid("jane")).toBe(true);
    expect(isInstallerUsernameValid("j")).toBe(false);
    expect(isInstallerUsernameValid("jane@host")).toBe(false);
  });
});

describe("isInstallerEmailValid", () => {
  it("requires something@something.something", () => {
    expect(isInstallerEmailValid("jane@example.com")).toBe(true);
    expect(isInstallerEmailValid(" jane@example.com ")).toBe(true);
    expect(isInstallerEmailValid("")).toBe(false);
    expect(isInstallerEmailValid("not-an-email")).toBe(false);
    expect(isInstallerEmailValid("jane@localhost")).toBe(false);
  });
});
