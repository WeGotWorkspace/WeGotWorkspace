import type { SettingsProfileRequest } from "@wgw/openapi-types/settings-types";
import { settingsProfileRequestOpenapiSchema } from "@wgw/openapi-types/settings-request-zod";
import { z } from "zod";

/**
 * Profile + optional password change for settings. Used with
 * {@link https://react-hook-form.com/ react-hook-form} + {@link zodResolver}.
 *
 * Wire JSON for `PUT /settings/profile` is validated with the OpenAPI-generated
 * {@link settingsProfileRequestOpenapiSchema} via {@link settingsProfileFormToRequest}.
 */
export const settingsProfileFormSchema = z
  .object({
    displayName: z.string().trim().min(1, "Display name is required"),
    email: z.string().trim().email("Enter a valid email"),
    newPassword: z.string(),
    confirmPassword: z.string(),
    currentPassword: z.string(),
  })
  .superRefine((values, ctx) => {
    const pwd = values.newPassword;
    if (pwd.length > 0 && pwd.length < 8) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Password must be at least 8 characters",
        path: ["newPassword"],
      });
    }
    if (pwd.length > 0 && values.confirmPassword !== pwd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Passwords do not match",
        path: ["confirmPassword"],
      });
    }
    if (pwd.length > 0 && values.currentPassword.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Current password is required",
        path: ["currentPassword"],
      });
    }
  });

export type SettingsProfileFormValues = z.infer<typeof settingsProfileFormSchema>;

/** Require the current password when the email differs from the loaded address. */
export function settingsProfileFormSchemaFor(baselineEmail: string) {
  return settingsProfileFormSchema.superRefine((values, ctx) => {
    const emailChanged = values.email.trim().toLowerCase() !== baselineEmail.trim().toLowerCase();
    if (emailChanged && values.currentPassword.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Current password is required",
        path: ["currentPassword"],
      });
    }
  });
}

/** Map UI form values to OpenAPI `SettingsProfileRequest` and validate against the spec. */
export function settingsProfileFormToRequest(
  values: SettingsProfileFormValues,
  baselineEmail?: string,
): SettingsProfileRequest {
  const password = values.newPassword.trim();
  const currentPassword = values.currentPassword.trim();
  const email = values.email.trim();
  const includeEmail =
    baselineEmail === undefined || email.toLowerCase() !== baselineEmail.trim().toLowerCase();

  return settingsProfileRequestOpenapiSchema.parse({
    displayName: values.displayName,
    ...(includeEmail ? { email } : {}),
    ...(password.length > 0 ? { password } : {}),
    ...(currentPassword.length > 0 ? { currentPassword } : {}),
  }) as SettingsProfileRequest;
}
