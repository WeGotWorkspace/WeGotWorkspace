/**
 * Web Push needs a controlling SW. Production always registers.
 * Vite dev only registers on loopback hosts — those are the secure origins
 * where HTTP push is allowed (localhost, 127.0.0.1, ::1, *.localhost).
 */
export function shouldRegisterServiceWorker(input: { prod: boolean; hostname: string }): boolean {
  if (input.prod) return true;
  return isLoopbackHostname(input.hostname);
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}
