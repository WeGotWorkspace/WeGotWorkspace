import { fetchWgwAuthToken } from "@/lib/api/wgw/auth-token";
import { fetchRtcSettings } from "@/lib/api/wgw/rtc";
import type { DocsCollabWireOperations } from "@/text-editor-core/docs-collab/docs-collab-wire";

/**
 * Live Notes body-collab wire — RTC mesh auth, same as Docs.
 * The body is saved by the shared collab path (`PUT /notes/items/{uid}`),
 * not `/files/collaboration`. Title, tags, notebook, and archive stay on the
 * Notes metadata outbox.
 */
export function createWgwNotesCollabWire(): DocsCollabWireOperations {
  return {
    fetchAuthToken: (input) => fetchWgwAuthToken(input),
    fetchRtcSettings: (input) =>
      fetchRtcSettings({
        url: input.url,
        bearerToken: input.bearerToken,
        channel: "collab",
      }),
  };
}
