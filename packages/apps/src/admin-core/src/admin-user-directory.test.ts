import { describe, expect, it, vi } from "vitest";
import {
  createTemporaryPassword,
  localCreatedUser,
  mapUserEnabled,
  mapUserProfile,
  removeUserById,
  validateCreateUser,
  validatePasswordChange,
} from "@/admin-core/src/admin-user-directory";
import { createAdminAppBootstrap } from "@/lib/api/mock/admin-bootstrap";

describe("validateCreateUser", () => {
  const { data } = createAdminAppBootstrap();

  it("requires a username and rejects case-insensitive duplicates", () => {
    expect(validateCreateUser(data.users, "  ")).toEqual({
      ok: false,
      message: "Username is required",
    });
    expect(validateCreateUser(data.users, " ALICE ")).toEqual({
      ok: false,
      message: "Username already exists",
    });
  });

  it("returns the trimmed username when it is free", () => {
    expect(validateCreateUser(data.users, " Bob ")).toEqual({ ok: true, username: "Bob" });
  });
});

describe("createTemporaryPassword", () => {
  it("prefixes a crypto.randomUUID token", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("11111111-1111-4111-8111-111111111111");
    expect(createTemporaryPassword()).toBe("Temp-11111111-1111-4111-8111-111111111111");
    vi.restoreAllMocks();
  });
});

describe("local user list edits", () => {
  const { data } = createAdminAppBootstrap();

  it("builds an enabled local user with trimmed fields", () => {
    expect(
      localCreatedUser({
        username: "bob",
        displayName: " Bob ",
        email: " bob@example.test ",
        createdAt: "2026-09-25T00:00:00.000Z",
      }),
    ).toEqual({
      id: "bob",
      username: "bob",
      displayName: "Bob",
      email: "bob@example.test",
      groups: [],
      createdAt: "2026-09-25T00:00:00.000Z",
      enabled: true,
    });
  });

  it("patches profile and enabled state only for the matching id", () => {
    const profiled = mapUserProfile(data.users, "carol", {
      displayName: " Carol ",
      email: " carol@example.test ",
    });
    expect(profiled[0]).toBe(data.users[0]);
    expect(profiled[1]).toMatchObject({ displayName: "Carol", email: "carol@example.test" });

    const enabled = mapUserEnabled(data.users, "carol", true);
    expect(enabled[1]?.enabled).toBe(true);
    expect(removeUserById(data.users, "alice").map((user) => user.id)).toEqual(["carol"]);
  });
});

describe("validatePasswordChange", () => {
  it("requires eight characters and a matching confirmation", () => {
    expect(validatePasswordChange("short", "short")).toBe("Password must be at least 8 characters");
    expect(validatePasswordChange("long-enough", "different")).toBe("Passwords do not match");
    expect(validatePasswordChange("long-enough", "long-enough")).toBeNull();
  });
});
