import type { SettingsProfileRequest } from "@wgw/openapi-types/settings-types";
import { settingsProfileRequestOpenapiSchema } from "@wgw/openapi-types/settings-request-zod";
import { z } from "zod";

/**
 * Settings › Profile is three forms (react-hook-form + zodResolver):
 * - display name, which saves itself;
 * - email, in the Change email dialog;
 * - password, in the Change password dialog.
 * Email and password need the current password. Each form sends only its own fields to
 * `PUT /settings/profile`; the request is checked against the OpenAPI schema.
 */

/** Same floor as the API (`SettingsProfileRequest`: `password` min 10). */
export const SETTINGS_PASSWORD_MIN_LENGTH = 10;

export const settingsDisplayNameFormSchema = z.object({
  displayName: z.string().trim().min(1, "Display name is required"),
});

export type SettingsDisplayNameFormValues = z.infer<typeof settingsDisplayNameFormSchema>;

const currentPasswordField = z.string().trim().min(1, "Current password is required");

/** The new address must differ from `currentEmail`, or there is nothing to change. */
export function settingsEmailFormSchemaFor(currentEmail: string) {
  return z
    .object({
      email: z.string().trim().email("Enter a valid email"),
      currentPassword: currentPasswordField,
    })
    .superRefine((values, ctx) => {
      if (values.email.trim().toLowerCase() === currentEmail.trim().toLowerCase()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "This is already your email",
          path: ["email"],
        });
      }
    });
}

export type SettingsEmailFormValues = z.infer<ReturnType<typeof settingsEmailFormSchemaFor>>;

/** No confirm field: the new password can be shown (eye toggle) to check it instead. */
export const settingsPasswordFormSchema = z.object({
  newPassword: z
    .string()
    .min(
      SETTINGS_PASSWORD_MIN_LENGTH,
      `Password must be at least ${SETTINGS_PASSWORD_MIN_LENGTH} characters`,
    ),
  currentPassword: currentPasswordField,
});

export type SettingsPasswordFormValues = z.infer<typeof settingsPasswordFormSchema>;

export function settingsDisplayNameRequest(
  values: SettingsDisplayNameFormValues,
): SettingsProfileRequest {
  return settingsProfileRequestOpenapiSchema.parse({
    displayName: values.displayName.trim(),
  }) as SettingsProfileRequest;
}

export function settingsEmailRequest(values: SettingsEmailFormValues): SettingsProfileRequest {
  return settingsProfileRequestOpenapiSchema.parse({
    email: values.email.trim(),
    currentPassword: values.currentPassword.trim(),
  }) as SettingsProfileRequest;
}

export function settingsPasswordRequest(
  values: SettingsPasswordFormValues,
): SettingsProfileRequest {
  return settingsProfileRequestOpenapiSchema.parse({
    password: values.newPassword,
    currentPassword: values.currentPassword.trim(),
  }) as SettingsProfileRequest;
}
