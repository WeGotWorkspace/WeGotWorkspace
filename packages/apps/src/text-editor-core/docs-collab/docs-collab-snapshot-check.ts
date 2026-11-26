import * as Y from "yjs";
import type { TextEditorContentFormat } from "@/text-editor-core/src/text-editor-content";
import { readNoteTitle } from "@/lib/collab/docs-collab-document-title";
import { collabShapeOf } from "@/lib/collab/collab-document-shape";
import { readContentFromYDoc } from "./docs-collab-editor-surface";
import { loadCollabText, type CollabText } from "@/lib/collab/docs-collab-server-io";
import {
  decideExternalWrite,
  isReadableYjsUpdate,
  type ExternalWriteAction,
} from "./docs-collab-external-write";

/**
 * What a stored state says about the text the server serves next to it.
 * `mismatch`: the bytes decode but hold another text. `undecodable`: no
 * client can read them, so they must not be applied.
 */
export type SnapshotTextCheck = "match" | "mismatch" | "undecodable";

const normalize = (text: string): string => text.replace(/\r\n?/g, "\n").trimEnd();

/**
 * The server stores the state a writer sends without reading it (#2208), so
 * one writer can store bytes whose text is not the title and body everyone
 * else reads (CalDAV, search, notifications), or bytes nobody can open.
 * Before a snapshot without the outside-write flag is adopted, its text is
 * projected the same way a save serializes it and compared with the server
 * text; anything else is handled as an outside write.
 *
 * The state and the text come from two reads, and a peer's save can land
 * between them. So the check runs only when both are one save: the state's
 * content tag (`X-Wgw-Content-Tag`) equals the tag of the text read. Without
 * that, the state is adopted as before. Only Notes and Tasks send the tag;
 * a Drive document is never checked.
 */
export function checkSnapshotText(
  update: Uint8Array,
  text: { markdown: string; title: string | null; etag?: string | null },
  format: TextEditorContentFormat,
  stateContentTag: string | null | undefined,
): SnapshotTextCheck {
  if (!isSameSave(stateContentTag, text.etag)) return "match";
  if (!isReadableYjsUpdate(update)) return "undecodable";
  const scratch = new Y.Doc();
  try {
    Y.applyUpdate(scratch, update);
    const shape = collabShapeOf(scratch);
    const markdown = shape ? shape.read(scratch) : readContentFromYDoc(scratch, format);
    // A doc without a title type leaves the server title alone on save; a
    // note with no SUMMARY serves `null` and its state holds no title.
    const served = text.title ?? "";
    const title = readNoteTitle(scratch, served);
    return normalize(markdown) === normalize(text.markdown) && title === served
      ? "match"
      : "mismatch";
  } catch {
    return "undecodable";
  } finally {
    scratch.destroy();
  }
}

/** Both tags present and equal: the state and the text are one save. */
export function isSameSave(
  stateContentTag: string | null | undefined,
  textTag: string | null | undefined,
): boolean {
  return Boolean(stateContentTag) && Boolean(textTag) && stateContentTag === textTag;
}

type StateTags = { update: Uint8Array | null; contentTag?: string | null };

/** The state is one save with `text` and holds another text, or none a client can read. */
export function stateHoldsOtherText(
  snapshot: StateTags & { update: Uint8Array },
  text: { markdown: string; title: string | null; etag?: string | null },
  format: TextEditorContentFormat,
): boolean {
  return checkSnapshotText(snapshot.update, text, format, snapshot.contentTag) !== "match";
}

/**
 * The reconnect decision for a stored state (`mergeServerState`). Without the
 * outside-write flag, a state that names its text is still adopted only when
 * it holds that text (#2208). The text is read only for such a state; when it
 * cannot be read, or is not the state's save, the state is adopted as before.
 * `readText` gives the text a prompt or rebuild needs, read once.
 */
export async function decideMergeAction(
  snapshot: StateTags & { externalWrite?: boolean },
  update: Uint8Array,
  {
    documentUrl,
    authToken,
    format,
    pendingLocalWork,
  }: {
    documentUrl: string;
    authToken: string | undefined;
    format: TextEditorContentFormat;
    pendingLocalWork: boolean;
  },
): Promise<{ action: ExternalWriteAction; readText: () => Promise<CollabText> }> {
  const flagged = snapshot.externalWrite === true;
  const checked =
    flagged || !snapshot.contentTag
      ? null
      : await loadCollabText(documentUrl, authToken).catch(() => null);
  const unlikeText =
    checked !== null && stateHoldsOtherText({ ...snapshot, update }, checked, format);
  return {
    action: decideExternalWrite(flagged || unlikeText, pendingLocalWork),
    readText: async () => checked ?? (await loadCollabText(documentUrl, authToken)),
  };
}

/**
 * The bootstrap decision for a stored state. Without the text there is
 * nothing to rebuild from or to ask about, so the state is adopted. A state
 * that does not hold the server text, or cannot be read, is handled as an
 * outside write (#2208).
 */
export function decideBootstrapAction(
  snapshot: StateTags & { update: Uint8Array; externalWrite: boolean },
  load: { markdown: string; markdownError: unknown },
  title: string | null,
  etag: string | null,
  { format, pendingLocalWork }: { format: TextEditorContentFormat; pendingLocalWork: boolean },
): ExternalWriteAction {
  if (load.markdownError) return "adopt";
  const unlikeText =
    !snapshot.externalWrite &&
    stateHoldsOtherText(snapshot, { markdown: load.markdown, title, etag }, format);
  return decideExternalWrite(snapshot.externalWrite || unlikeText, pendingLocalWork);
}
