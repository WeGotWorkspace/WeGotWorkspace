import { fetchWgwAuthToken } from "@/lib/api/wgw/auth-token";
import { fetchRtcSettings } from "@/lib/api/wgw/rtc";
import type { DocsCollabWireOperations } from "./docs-collab-wire";

/**
 * The live wire of a collab room against the WGW API: mesh auth and RTC
 * settings on the `collab` channel. The save goes to the room's own
 * `documentUrl`, so one wire serves every app that embeds the session.
 */
export function createWgwCollabWire(): DocsCollabWireOperations {
  return {
    fetchAuthToken: (input) => fetchWgwAuthToken(input),
    fetchRtcSettings: (input) =>
      fetchRtcSettings({ url: input.url, bearerToken: input.bearerToken, channel: "collab" }),
  };
}
