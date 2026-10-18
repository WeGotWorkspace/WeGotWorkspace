import { useCallback, useMemo, useState } from "react";
import type * as Y from "yjs";
import {
  type ExternalWriteDetail,
  replaceDocumentWithExternalText,
} from "./docs-collab-external-write";
import type { DocsCollabUrls } from "./docs-collab-types";
import { collabDocumentFormat } from "./docs-collab-utils";

export type DocsExternalWriteRequest = {
  /** The urls to hand to `useDocsCollab`, with `onExternalWrite` wired. */
  urls: DocsCollabUrls | undefined;
  detail: ExternalWriteDetail | null;
  clear: () => void;
};

/**
 * Catches the join path's question. Without this, the join holds saves on
 * `prompt` and asks nobody (#1349).
 */
export function useDocsExternalWriteRequest(
  urls: DocsCollabUrls | undefined,
): DocsExternalWriteRequest {
  const [detail, setDetail] = useState<ExternalWriteDetail | null>(null);
  const collabUrls = useMemo(
    () => (urls ? { ...urls, onExternalWrite: setDetail } : undefined),
    [urls],
  );
  const clear = useCallback(() => setDetail(null), []);
  return { urls: collabUrls, detail, clear };
}

export type DocsExternalWritePrompt = {
  open: boolean;
  busy: boolean;
  keepLocal: () => void;
  useOutside: () => void;
};

/**
 * The two answers. Saves stay held until one of them runs, so the prompt has
 * no dismiss: closing it would write neither version.
 */
export function useDocsExternalWritePrompt({
  request,
  room,
  ydoc,
  resolveExternalWrite,
  onOutsideApplied,
}: {
  request: DocsExternalWriteRequest;
  room: string | undefined;
  ydoc: Y.Doc | null;
  resolveExternalWrite: (suppliedMarkdown: string | null) => Promise<void>;
  onOutsideApplied?: () => void;
}): DocsExternalWritePrompt {
  const [busy, setBusy] = useState(false);
  const { detail, clear } = request;

  const keepLocal = useCallback(() => {
    setBusy(true);
    void resolveExternalWrite(null)
      .then(clear)
      .finally(() => setBusy(false));
  }, [clear, resolveExternalWrite]);

  const useOutside = useCallback(() => {
    if (!detail || !ydoc) return;
    setBusy(true);
    replaceDocumentWithExternalText(
      ydoc,
      detail.markdown,
      detail.title,
      collabDocumentFormat(room),
    );
    void resolveExternalWrite(detail.markdown)
      .then(() => {
        clear();
        onOutsideApplied?.();
      })
      .finally(() => setBusy(false));
  }, [clear, detail, onOutsideApplied, resolveExternalWrite, room, ydoc]);

  return { open: detail !== null, busy, keepLocal, useOutside };
}
