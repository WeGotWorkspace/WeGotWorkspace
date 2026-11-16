import { describe, expect, it } from "vitest";
import {
  settingsDisplayNameFormSchema,
  settingsDisplayNameRequest,
  settingsEmailFormSchemaFor,
  settingsEmailRequest,
  settingsPasswordFormSchema,
  settingsPasswordRequest,
} from "@/settings-core/src/settings-profile-form-schema";

describe("settings profile requests", () => {
  it("sends only the display name for the display name form", () => {
    expect(settingsDisplayNameRequest({ displayName: "  Jane Doe " })).toEqual({
      displayName: "Jane Doe",
    });
  });

  it("sends the email with the current password", () => {
    expect(
      settingsEmailRequest({ email: " jane@example.com ", currentPassword: "secret" }),
    ).toEqual({ email: "jane@example.com", currentPassword: "secret" });
  });

  it("sends the password with the current password", () => {
    expect(
      settingsPasswordRequest({ newPassword: "newpassword", currentPassword: "secret" }),
    ).toEqual({ password: "newpassword", currentPassword: "secret" });
  });
});

describe("settings profile schemas", () => {
  it("requires a display name", () => {
    expect(settingsDisplayNameFormSchema.safeParse({ displayName: "  " }).success).toBe(false);
  });

  it("rejects an invalid email", () => {
    const result = settingsEmailFormSchemaFor("jane@example.com").safeParse({
      email: "not-an-email",
      currentPassword: "secret",
    });
    expect(result.success).toBe(false);
  });

  it("rejects the email the user already has", () => {
    const result = settingsEmailFormSchemaFor("jane@example.com").safeParse({
      email: "JANE@example.com",
      currentPassword: "secret",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("This is already your email");
  });

  it("requires the current password to change the email", () => {
    const result = settingsEmailFormSchemaFor("jane@example.com").safeParse({
      email: "other@example.com",
      currentPassword: "",
    });
    expect(result.success).toBe(false);
  });

  it("requires the current password to change the password", () => {
    const result = settingsPasswordFormSchema.safeParse({
      newPassword: "newpassword",
      currentPassword: "",
    });
    expect(result.success).toBe(false);
  });

  it("holds a new password to the API's 10 characters", () => {
    expect(
      settingsPasswordFormSchema.safeParse({ newPassword: "short1234", currentPassword: "x" })
        .success,
    ).toBe(false);
    expect(
      settingsPasswordFormSchema.safeParse({ newPassword: "longenough", currentPassword: "x" })
        .success,
    ).toBe(true);
  });
});
