export function isRecipientEmail(value: string): boolean {
  const email = value.trim();
  if (!email.includes("@")) return false;
  const [, domain] = email.split("@");
  return Boolean(domain?.includes("."));
}
