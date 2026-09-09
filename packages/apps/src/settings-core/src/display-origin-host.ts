/**
 * Hostname (and non-default port) for a client origin — no `https://`.
 * Shared by Connect-assistant consent and Settings Connected assistants.
 */
export function displayOriginHost(origin: string): string {
  try {
    const url = origin.includes("://") ? new URL(origin) : new URL(`https://${origin}`);
    return url.port !== "" ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    return origin.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  }
}
