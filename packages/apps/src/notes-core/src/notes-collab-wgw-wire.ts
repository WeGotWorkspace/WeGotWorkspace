import { fetchWgwAuthToken } from "@/lib/api/wgw/auth-token";
import { fetchRtcSettings } from "@/lib/api/wgw/rtc";
import type { DocsCollabWireOperations } from "@/text-editor-core/docs-collab/docs-collab-wire";

/**
 * Live Notes body-collab wire — RTC mesh auth, same as Docs.
 * Persist is `PATCH /notes/items/{uid}` via `buildNoteCollabUrls`, not
 * `/files/collaboration`.
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
