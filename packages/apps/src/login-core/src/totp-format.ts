import type { ClipboardEvent } from "react";

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

/**
 * A spaced code such as `123 456` is longer than `maxlength=6`, so the browser
 * drops a digit before `onChange`. Read the clipboard and keep six digits.
 */
export function applyTotpPaste(
  event: ClipboardEvent<HTMLInputElement>,
  apply: (code: string) => void,
): void {
  const text = event.clipboardData?.getData("text") ?? "";
  if (!text.trim()) return;
  event.preventDefault();
  apply(digitsOnly(text));
}

export function groupTotpSecret(secret: string): string {
  const compact = secret.replace(/\s+/g, "");
  return compact.match(/.{1,4}/g)?.join(" ") ?? compact;
}
