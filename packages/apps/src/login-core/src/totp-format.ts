export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

export function groupTotpSecret(secret: string): string {
  const compact = secret.replace(/\s+/g, "");
  return compact.match(/.{1,4}/g)?.join(" ") ?? compact;
}
