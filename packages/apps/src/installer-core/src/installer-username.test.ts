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
  it("matches PHP FILTER_VALIDATE_EMAIL", () => {
    expect(isInstallerEmailValid("jane@example.com")).toBe(true);
    expect(isInstallerEmailValid(" jane@example.com ")).toBe(true);
    expect(isInstallerEmailValid("user.name+tag@example.com")).toBe(true);
    expect(isInstallerEmailValid("")).toBe(false);
    expect(isInstallerEmailValid("not-an-email")).toBe(false);
    expect(isInstallerEmailValid("jane@localhost")).toBe(false);
    expect(isInstallerEmailValid("user@domain..com")).toBe(false);
    expect(isInstallerEmailValid("user@example.com.")).toBe(false);
    expect(isInstallerEmailValid("user@exam_ple.com")).toBe(false);
    expect(isInstallerEmailValid("user@example.123")).toBe(false);
  });
});
