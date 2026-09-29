export const MFA_SETUP_REQUIRED = "mfa_setup_required";

export function isMfaSetupRequiredError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: unknown }).code === MFA_SETUP_REQUIRED;
}
