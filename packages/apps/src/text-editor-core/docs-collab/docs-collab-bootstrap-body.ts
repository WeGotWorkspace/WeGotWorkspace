import * as Y from "yjs";
import { applyContentSeedToYDoc, readContentFromYDoc } from "./docs-collab-editor-surface";
import { collabDocumentFormat, isYDocEmpty } from "./docs-collab-utils";

export type BootstrapBodyOutcome = "empty-intentional" | "sidecar" | "seeded-markdown";

/**
 * After HTTP bootstrap, the Y.Doc must contain something TipTap can render. A
 * present sidecar or IndexedDB state can leave the fragment technically
 * non-empty while {@link readContentFromYDoc} is still blank (schema drift) or
 * the editor mounted before hydration finished. Markdown on disk is the read
 * fallback — local only, no server rewrite.
 */
export function ensureBootstrapEditorBody(
  ydoc: Y.Doc,
  markdown: string,
  room: string | undefined,
): BootstrapBodyOutcome {
  const format = collabDocumentFormat(room);
  const seed = markdown.trim();
  if (!seed) {
    return isYDocEmpty(ydoc) ? "empty-intentional" : "sidecar";
  }

  let visible = "";
  try {
    visible = readContentFromYDoc(ydoc, format).trim();
  } catch {
    visible = "";
  }

  const normalize = (value: string) => value.replace(/\r\n/g, "\n").trim();
  if (normalize(visible) === normalize(markdown)) return "sidecar";

  applyContentSeedToYDoc(ydoc, markdown, format);
  return "seeded-markdown";
}
