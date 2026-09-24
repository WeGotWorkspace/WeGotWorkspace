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
  });

export type SettingsProfileFormValues = z.infer<typeof settingsProfileFormSchema>;

/** Map UI form values to OpenAPI `SettingsProfileRequest` and validate against the spec. */
export function settingsProfileFormToRequest(
  values: SettingsProfileFormValues,
): SettingsProfileRequest {
  const password = values.newPassword.trim();
  return settingsProfileRequestOpenapiSchema.parse({
    displayName: values.displayName,
    email: values.email,
    ...(password.length > 0 ? { password } : {}),
  }) as SettingsProfileRequest;
}
