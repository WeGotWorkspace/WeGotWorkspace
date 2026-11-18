import {
  fetchYjsSnapshot,
  loadCollabText,
  type CollabText,
} from "@/lib/collab/docs-collab-server-io";
import type { TextEditorContentFormat } from "@/text-editor-core/src/text-editor-content";
import { checkSnapshotText } from "./docs-collab-snapshot-check";

export type StableTextCheck = { mismatch: boolean; text: CollabText };

/**
 * The state and the text are two GETs, so a peer's save between them makes an
 * honest state look unlike the text. The text is read after `snapshot` and the
 * state's tag again after the text: only when the tag held (one save for all
 * three reads) is a difference an outside write. Returns null when that cannot
 * be told (a read failed, the tag is missing or moved): the caller adopts the
 * state, as it did before the check existed.
 */
export async function loadStableTextCheck(
  snapshot: { update: Uint8Array; etag: string | null },
  urls: { documentUrl: string; yjsUrl: string },
  authToken: string | undefined,
  format: TextEditorContentFormat,
): Promise<StableTextCheck | null> {
  if (!snapshot.etag) return null;
  try {
    const text = await loadCollabText(urls.documentUrl, authToken);
    const mismatch = checkSnapshotText(snapshot.update, text, format) !== "match";
    if (!mismatch) return { mismatch: false, text };
    const again = await fetchYjsSnapshot(urls.yjsUrl, authToken);
    if (!again.update || again.etag !== snapshot.etag) return null;
    return { mismatch: true, text };
  } catch (error) {
    console.warn("[docs-collab] snapshot check skipped", error);
    return null;
  }
}
