/** Copy shared by the sign-in step (#2274) and two-factor setup in Settings (#2275). */
export const twoFactorLabels = {
  codeLabel: "Code",
  codePlaceholder: "123 456",
  recoveryCodeLabel: "Recovery code",
  recoveryCodePlaceholder: "abcd-1234-ef56-7890",
  qrLabel: "QR code for your authenticator app",
  secretLabel: "Setup key",
  secretHint: "Can't scan? Enter this key in the app instead.",
  copySecret: "Copy setup key",
  copiedSecret: "Setup key copied",
  copyCodes: "Copy codes",
  copiedCodes: "Recovery codes copied",
  copyFailed: "Could not copy. Select the text and copy it yourself.",
  codesSaved: "I saved these codes somewhere safe",
  clockHint: "Check that the time on your phone is set automatically.",
} as const;

/** `JBSWY3DPEHPK3PXP` → `JBSW Y3DP EHPK 3PXP`, easier to type from the screen. */
export function groupInFours(value: string): string {
  return (
    value
      .replace(/\s+/g, "")
      .match(/.{1,4}/g)
      ?.join(" ") ?? ""
  );
}
