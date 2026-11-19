import * as Y from "yjs";
import type { CollabText } from "@/lib/collab/docs-collab-server-io";
import { SERVER_ORIGIN } from "@/lib/collab/docs-collab-utils";
import type { TextEditorContentFormat } from "@/text-editor-core/src/text-editor-content";
import {
  replaceDocumentWithExternalText,
  type ExternalWriteAction,
} from "./docs-collab-external-write";
import type { DocsCollabSessionRefs, DocsCollabUrls } from "./docs-collab-types";

/**
 * Carry out the reconnect decision for a stored state (`mergeServerState`):
 * ask the person, rebuild from the outside text, or adopt the state. Returns
 * whether the document now holds the server's state (not when it asks).
 */
export async function settleMergeAction({
  action,
  readText,
  ydoc,
  update,
  refs,
  urls,
  format,
  updatePendingState,
}: {
  action: ExternalWriteAction;
  readText: () => Promise<CollabText>;
  ydoc: Y.Doc;
  update: Uint8Array;
  refs: DocsCollabSessionRefs;
  urls: DocsCollabUrls;
  format: TextEditorContentFormat;
  updatePendingState: (pending: boolean, failed?: boolean) => Promise<void>;
}): Promise<boolean> {
  if (action === "adopt") {
    Y.applyUpdate(ydoc, update, SERVER_ORIGIN);
    return true;
  }
  const text = await readText();
  refs.externalWriteSeenRef.current = text.etag ?? null;
  if (action === "prompt") {
    refs.externalWriteHoldRef.current = true;
    urls.onExternalWrite?.({ markdown: text.markdown, title: text.title, serverState: update });
    return false;
  }
  replaceDocumentWithExternalText(ydoc, text.markdown, text.title, format, update);
  refs.markdownOverrideRef.current = text.markdown;
  refs.externalWriteHoldRef.current = false;
  refs.localDirtySinceLastSaveRef.current = true;
  refs.lastSuccessfulSaveSignatureRef.current = null;
  await updatePendingState(true, false);
  return true;
}
