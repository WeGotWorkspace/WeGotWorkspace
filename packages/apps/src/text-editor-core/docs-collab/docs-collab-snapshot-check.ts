import * as Y from "yjs";
import type { TextEditorContentFormat } from "@/text-editor-core/src/text-editor-content";
import { readNoteTitle } from "@/lib/collab/docs-collab-document-title";
import { readContentFromYDoc } from "./docs-collab-editor-surface";
import { isReadableYjsUpdate } from "./docs-collab-external-write";

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
 * Only text-fields resources (Notes, Tasks) are checked: they serve a title,
 * and their content tag covers exactly this title and body. A Drive
 * document (raw markdown, no title field) is not checked. A note whose title
 * is null (a journal without SUMMARY) still has its body compared.
 */
export function checkSnapshotText(
  update: Uint8Array,
  text: { markdown: string; title: string | null; titled?: boolean },
  format: TextEditorContentFormat,
): SnapshotTextCheck {
  if (text.title === null && text.titled !== true) return "match";
  if (!isReadableYjsUpdate(update)) return "undecodable";
  const scratch = new Y.Doc();
  try {
    Y.applyUpdate(scratch, update);
    const markdown = readContentFromYDoc(scratch, format);
    // A doc without a title type leaves the server title alone on save.
    const title = readNoteTitle(scratch, text.title);
    const serverTitle = text.title ?? "";
    return normalize(markdown) === normalize(text.markdown) && title === serverTitle
      ? "match"
      : "mismatch";
  } catch {
    return "undecodable";
  } finally {
    scratch.destroy();
  }
}
