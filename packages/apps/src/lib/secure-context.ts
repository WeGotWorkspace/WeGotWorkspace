/** What `isPageSecureContext` reads; a parameter so tests can pass any page. */
export type SecureContextProbe = {
  isSecureContext?: boolean;
  location?: { protocol: string; hostname: string };
};

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Whether the browser treats this page as a secure context (https, or localhost),
 * so `crypto.subtle`, service workers and the other secure-only APIs are there.
 * Browsers without `isSecureContext` fall back to the same rule by hand.
 */
export function isPageSecureContext(
  probe: SecureContextProbe | undefined = globalThis as SecureContextProbe,
): boolean {
  if (probe == null) return true;
  if (typeof probe.isSecureContext === "boolean") return probe.isSecureContext;
  const location = probe.location;
  if (location == null) return true;
  if (location.protocol === "https:") return true;
  const host = location.hostname.toLowerCase();
  return LOOPBACK_HOSTNAMES.has(host) || host.endsWith(".localhost");
}
