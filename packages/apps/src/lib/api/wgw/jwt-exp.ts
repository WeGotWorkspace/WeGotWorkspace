function decodeBase64UrlUtf8(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  const padded =
    padding === 0 ? normalized : normalized.padEnd(normalized.length + (4 - padding), "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const decoded = decodeBase64UrlUtf8(payload);
    const json = JSON.parse(decoded);
    return json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Decode the JWT `exp` claim as an epoch-seconds timestamp.
 * Returns `null` when the token shape or payload is invalid.
 */
export function decodeJwtExp(token: string): number | null {
  const json = decodeJwtPayload(token);
  if (!json) return null;
  return typeof json.exp === "number" && Number.isFinite(json.exp) ? json.exp : null;
}
