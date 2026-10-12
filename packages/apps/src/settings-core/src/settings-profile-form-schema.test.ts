import { describe, expect, it } from "vitest";
import {
  settingsProfileFormSchema,
  settingsProfileFormSchemaFor,
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
        currentPassword: "",
      }),
    ).toEqual({
      displayName: "Jane Doe",
      email: "jane@example.com",
    });
  });

  it("includes password and current password when set", () => {
    expect(
      settingsProfileFormToRequest({
        displayName: "Jane Doe",
        email: "jane@example.com",
        newPassword: "newpassword",
        confirmPassword: "newpassword",
        currentPassword: "secret",
      }),
    ).toEqual({
      displayName: "Jane Doe",
      email: "jane@example.com",
      password: "newpassword",
      currentPassword: "secret",
    });
  });

  it("omits an unchanged email when a baseline is provided", () => {
    expect(
      settingsProfileFormToRequest(
        {
          displayName: "Jane Doe",
          email: "jane@example.com",
          newPassword: "",
          confirmPassword: "",
          currentPassword: "",
        },
        "jane@example.com",
      ),
    ).toEqual({
      displayName: "Jane Doe",
    });
  });

  it("omits password when blank", () => {
    const result = settingsProfileFormToRequest({
      displayName: "Jane Doe",
      email: "jane@example.com",
      newPassword: "   ",
      confirmPassword: "",
      currentPassword: "",
    });
    expect(result).not.toHaveProperty("password");
  });

  it("rejects invalid email in the form schema before mapping", () => {
    const result = settingsProfileFormSchema.safeParse({
      displayName: "Jane",
      email: "not-an-email",
      newPassword: "",
      confirmPassword: "",
      currentPassword: "",
    });
    expect(result.success).toBe(false);
  });

  it("requires the current password when the email changes", () => {
    const result = settingsProfileFormSchemaFor("jane@example.com").safeParse({
      displayName: "Jane Doe",
      email: "other@example.com",
      newPassword: "",
      confirmPassword: "",
      currentPassword: "",
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
      currentPassword: "",
    });
    expect(Object.keys(result).sort()).toEqual(["displayName", "email"]);
  });
});
