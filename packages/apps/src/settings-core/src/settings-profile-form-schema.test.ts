import { describe, expect, it } from "vitest";
import {
  settingsProfileFormSchema,
  settingsProfileFormToRequest,
} from "@/settings-core/src/settings-profile-form-schema";

describe("settingsProfileFormToRequest", () => {
  it("maps identity fields to OpenAPI SettingsProfileRequest", () => {
    expect(
      settingsProfileFormToRequest({
        displayName: "Jane Doe",
        email: "jane@example.com",
        newPassword: "",
        confirmPassword: "",
      }),
    ).toEqual({
      displayName: "Jane Doe",
      email: "jane@example.com",
    });
  });

  it("includes password when set", () => {
    expect(
      settingsProfileFormToRequest({
        displayName: "Jane Doe",
        email: "jane@example.com",
        newPassword: "newpassword",
        confirmPassword: "newpassword",
      }),
    ).toEqual({
      displayName: "Jane Doe",
      email: "jane@example.com",
      password: "newpassword",
    });
  });

  it("omits password when blank", () => {
    const result = settingsProfileFormToRequest({
      displayName: "Jane Doe",
      email: "jane@example.com",
      newPassword: "   ",
      confirmPassword: "",
    });
    expect(result).not.toHaveProperty("password");
  });

  it("rejects invalid email in the form schema before mapping", () => {
    const result = settingsProfileFormSchema.safeParse({
      displayName: "Jane",
      email: "not-an-email",
      newPassword: "",
      confirmPassword: "",
    });
    expect(result.success).toBe(false);
  });

  it("requires the current password when a new password is set", () => {
    const values = {
      displayName: "Jane Doe",
      email: "jane@example.com",
      newPassword: "newpassword",
      confirmPassword: "newpassword",
      currentPassword: "",
    };
    expect(settingsProfileFormSchema.safeParse(values).success).toBe(false);
  });

  it("returns only OpenAPI SettingsProfileRequest fields", () => {
    const result = settingsProfileFormToRequest({
      displayName: "Jane Doe",
      email: "jane@example.com",
      newPassword: "",
      confirmPassword: "",
    });
    expect(Object.keys(result).sort()).toEqual(["displayName", "email"]);
  });
});
