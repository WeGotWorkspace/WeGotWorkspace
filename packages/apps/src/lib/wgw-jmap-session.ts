import { wgwApiBaseUrl, wgwFetch } from "@/lib/api/wgw/http";
import { JmapClient } from "@/lib/jmap-client";

export function wgwJmapRelativePath(input: string): string {
  const base = wgwApiBaseUrl();
  const url = new URL(input, window.location.origin);
  const path = url.pathname + url.search;
  return path.startsWith(base) ? path.slice(base.length) : path;
}

export async function connectWgwJmapClient(): Promise<JmapClient> {
  const client = new JmapClient({
    sessionUrl: "/jmap/session",
    fetch: (input, init) => wgwFetch(wgwJmapRelativePath(String(input)), init ?? {}),
  });
  if (!client.isConnected) await client.connect();
  return client;
}
