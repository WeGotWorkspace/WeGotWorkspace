import { wgwApiBaseUrl, wgwFetch } from "@/lib/api/wgw/http";
import { JmapClient } from "@/lib/jmap-client";

function toApiRelativePath(input: string): string {
  const base = wgwApiBaseUrl();
  const url = new URL(input, window.location.origin);
  const path = url.pathname + url.search;
  return path.startsWith(base) ? path.slice(base.length) : path;
}

/** Fresh inbound client — JmapClient tracks per-type sync states. */
export function createNotesJmapClient(): JmapClient {
  return new JmapClient({
    sessionUrl: "/jmap/session",
    fetch: (input, init) => wgwFetch(toApiRelativePath(input), init ?? {}),
  });
}
