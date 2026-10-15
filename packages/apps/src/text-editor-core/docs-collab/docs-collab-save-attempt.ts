import type * as Y from "yjs";
import { getConnectivitySnapshot } from "@/lib/offline/browser-online";
import { reportDocsSyncConflicts } from "@/lib/offline/docs/docs-sync-conflicts";
import { rememberSidecarEtag, sidecarPrecondition } from "./docs-collab-etag";
import { loadYjsSnapshot, saveDocument } from "./docs-collab-server-io";
import type { DocsCollabUrls } from "./docs-collab-types";
import { isServerDivergenceError, SERVER_ORIGIN } from "./docs-collab-utils";

export type CollabSaveAttempt = {
  urls: DocsCollabUrls;
  /** ETag map key. The hook's room, which is the same value as `urls.room`. */
  room: string;
  ydoc: Y.Doc;
  markdown: string;
  authToken?: string;
  /** Stays set when a remerge fails, so a later attempt does not loop. */
  remergeAttempted: { current: boolean };
  /** Body to send after the server snapshot has been merged in. */
  markdownAfterMerge: () => string;
  /**
   * Markdown supplied for this save. Cleared when the attempt starts and put
   * back if the save fails, so a later retry still has it.
   */
  markdownOverrideRef?: { current: string | null };
};

export type CollabSaveAttemptResult = { status: "skipped" } | { status: "saved"; markdown: string };

/**
 * The shared save both apps use. One attempt, then on 409/412/428 reload the
 * snapshot, merge, and save once more. A room with no server id yet does not
 * touch the server. A divergence that survives that remerge is reported; a
 * merge that lands is not.
 */
export async function persistCollabSave(
  input: CollabSaveAttempt,
): Promise<CollabSaveAttemptResult> {
  if (input.urls.roomNotPersistent) return { status: "skipped" };

  const overrideRef = input.markdownOverrideRef;
  const heldOverride = overrideRef?.current ?? null;
  if (heldOverride !== null && overrideRef) overrideRef.current = null;

  const attemptSave = async (body: string): Promise<void> => {
    const etag = await saveDocument(
      input.urls.documentUrl,
      body,
      input.ydoc,
      input.urls.room,
      input.authToken,
      sidecarPrecondition(input.room),
    );
    rememberSidecarEtag(input.room, etag);
  };

  let savedMarkdown = input.markdown;
  try {
    try {
      await attemptSave(savedMarkdown);
    } catch (firstError) {
      const canRemerge =
        isServerDivergenceError(firstError) &&
        !input.remergeAttempted.current &&
        getConnectivitySnapshot();
      if (!canRemerge) throw firstError;

      input.remergeAttempted.current = true;
      const reload = await loadYjsSnapshot(
        input.urls.yjsUrl,
        input.ydoc,
        input.authToken,
        SERVER_ORIGIN,
      );
      rememberSidecarEtag(input.room, reload.etag);
      if (!reload.applied) throw firstError;
      savedMarkdown = input.markdownAfterMerge();
      await attemptSave(savedMarkdown);
    }

    input.remergeAttempted.current = false;
    return { status: "saved", markdown: savedMarkdown };
  } catch (error) {
    if (heldOverride !== null && overrideRef) overrideRef.current = heldOverride;
    if (isServerDivergenceError(error) && getConnectivitySnapshot()) {
      reportDocsSyncConflicts([input.room]);
    }
    throw error;
  }
}
