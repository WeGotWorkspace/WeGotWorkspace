/** SPDX id of the license the whole project ships under. */
export const PROJECT_LICENSE = "AGPL-3.0-or-later";

export const DEFAULT_SOURCE_CODE_URL = "https://github.com/WeGotWorkspace/wegotworkspace";

/**
 * Where users can get the Corresponding Source (AGPL-3.0 §13).
 * A hoster that ships a modified build sets `VITE_WGW_SOURCE_URL` at build time to point at its own
 * source. Anything that is not an http(s) URL falls back to the upstream repository.
 */
export function sourceCodeUrl(
  raw: string | undefined = import.meta.env.VITE_WGW_SOURCE_URL as string | undefined,
): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_SOURCE_CODE_URL;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : DEFAULT_SOURCE_CODE_URL;
  } catch {
    return DEFAULT_SOURCE_CODE_URL;
  }
}
