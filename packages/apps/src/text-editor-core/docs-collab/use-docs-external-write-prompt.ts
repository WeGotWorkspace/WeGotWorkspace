import { useCallback, useEffect, useMemo, useState } from "react";
import type * as Y from "yjs";
import {
  type ExternalWriteDetail,
  replaceDocumentWithExternalText,
} from "./docs-collab-external-write";
import type { DocsCollabUrls } from "./docs-collab-types";
import { collabFormatForUrls } from "./docs-collab-utils";

export type DocsExternalWriteRequest = {
  /** The urls to hand to `useDocsCollab`, with `onExternalWrite` wired. */
  urls: DocsCollabUrls | undefined;
  /** Only the question for the document open now. */
  detail: ExternalWriteDetail | null;
  clear: () => void;
};

type PendingQuestion = { room: string | undefined; detail: ExternalWriteDetail };

/**
 * Catches the join path's question. Without this, the join holds saves on
 * `prompt` and asks nobody (#1349). The workspace is not remounted per
 * document, so a question is kept with its room and dropped on a switch:
 * an answer must never write one document's outside text into another.
 */
export function useDocsExternalWriteRequest(
  urls: DocsCollabUrls | undefined,
): DocsExternalWriteRequest {
  const room = urls?.room;
  const [pending, setPending] = useState<PendingQuestion | null>(null);
  const collabUrls = useMemo(
    () =>
      urls
        ? {
            ...urls,
            onExternalWrite: (detail: ExternalWriteDetail) =>
              setPending({ room: urls.room, detail }),
          }
        : undefined,
    [urls],
  );
  useEffect(() => {
    setPending(null);
  }, [room]);
  const clear = useCallback(() => setPending(null), []);
  const detail = pending !== null && pending.room === room ? pending.detail : null;
  return { urls: collabUrls, detail, clear };
}

export type DocsExternalWritePrompt = {
  open: boolean;
  busy: boolean;
  /** The outside text already replaced the local edits; only a retry is left. */
  keepLocalDisabled: boolean;
  keepLocal: () => void;
  useOutside: () => void;
};

/**
 * The two answers. Saves stay held until one of them is saved, so the prompt
 * has no dismiss, and a failed save leaves it up. The save hook already
 * reports the failure in the sync status.
 */
export function useDocsExternalWritePrompt({
  request,
  ydoc,
  resolveExternalWrite,
  onOutsideApplied,
}: {
  request: DocsExternalWriteRequest;
  ydoc: Y.Doc | null;
  resolveExternalWrite: (suppliedMarkdown: string | null) => Promise<void>;
  onOutsideApplied?: () => void;
}): DocsExternalWritePrompt {
  const [busy, setBusy] = useState(false);
  const [appliedOutside, setAppliedOutside] = useState<ExternalWriteDetail | null>(null);
  const { detail, clear } = request;
  // Set for the whole question chain: a second outside edit during the
  // answer asks again, and the local edits are still gone.
  const keepLocalDisabled = detail !== null && appliedOutside !== null;
  useEffect(() => {
    if (detail === null) setAppliedOutside(null);
  }, [detail]);

  const answer = useCallback(
    (suppliedMarkdown: string | null) => {
      setBusy(true);
      void resolveExternalWrite(suppliedMarkdown)
        .then(clear)
        .catch(() => undefined)
        .finally(() => setBusy(false));
    },
    [clear, resolveExternalWrite],
  );

  const keepLocal = useCallback(() => {
    if (keepLocalDisabled) return;
    answer(null);
  }, [answer, keepLocalDisabled]);

  const useOutside = useCallback(() => {
    if (!detail || !ydoc) return;
    if (appliedOutside !== detail) {
      replaceDocumentWithExternalText(
        ydoc,
        detail.markdown,
        detail.title,
        collabFormatForUrls(request.urls),
      );
      setAppliedOutside(detail);
      onOutsideApplied?.();
    }
    answer(detail.markdown);
  }, [answer, appliedOutside, detail, onOutsideApplied, request.urls, ydoc]);

  return { open: detail !== null, busy, keepLocalDisabled, keepLocal, useOutside };
}
