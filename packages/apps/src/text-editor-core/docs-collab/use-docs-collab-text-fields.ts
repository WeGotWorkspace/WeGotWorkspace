import { useCallback, useRef } from "react";
import type * as Y from "yjs";
import type { BootstrapLoad } from "@/lib/collab/docs-collab-bootstrap";
import { rememberSidecarEtag } from "@/lib/collab/docs-collab-etag";
import {
  fetchYjsSnapshot,
  loadCollabText,
  type CollabText,
} from "@/lib/collab/docs-collab-server-io";
import type { TextEditorContentFormat } from "@/lib/files/text-content-format";
import { applyContentSeedToYDoc } from "./docs-collab-editor-surface";
import { collabDocumentShapeById, markCollabShapeDoc } from "@/lib/collab/collab-document-shape";
import { SEED_ORIGIN } from "@/lib/collab/docs-collab-utils";
import {
  markTextFieldsDoc,
  observeTextFieldsSeeds,
  seedTextFields,
} from "./docs-collab-text-fields";
import { rereadTextFields, type TextFieldsRereadResult } from "./docs-collab-text-fields-reread";
import { hasPendingLocalWork } from "./use-docs-collab-session-refs";
import type { DocsCollabSessionRefs, DocsCollabUrls } from "./docs-collab-types";

export type TextFieldsBootstrapSettlement = {
  settlement: "adopted" | "replaced" | "prompted";
  keptLocalEdits: boolean;
};

/**
 * The text-fields shape inside the shared session (#2208): seed, the re-read
 * (cases 1-4 of spec.md, The re-read) on bootstrap and on a later merge, and
 * the document set-up. Docs and Notes get the editor seed and `null` from
 * every text-fields step, so their path is unchanged.
 */
export function useDocsCollabTextFields({
  refs,
  room,
  urls,
  documentFormat,
  loadedStateRef,
}: {
  refs: DocsCollabSessionRefs;
  /** The state the local copy held when IndexedDB finished loading. */
  loadedStateRef: { current: { ydoc: Y.Doc; stateVector: Map<number, number> } | null };
  room: string;
  urls: DocsCollabUrls;
  documentFormat: TextEditorContentFormat;
}) {
  const textFields = urls.documentShape === "text-fields";
  /** The text the server served last: the seed's title and content tag, the replacement's salt. */
  const servedRef = useRef<CollabText | null>(null);

  /** Mark a new document before IndexedDB loads, so emptiness and the seed ask the shape. */
  const prepareDoc = useCallback(
    (ydoc: Y.Doc) => {
      const registered = collabDocumentShapeById(urls.documentShape);
      if (registered) markCollabShapeDoc(ydoc, registered);
      if (!textFields) return;
      markTextFieldsDoc(ydoc);
      observeTextFieldsSeeds(ydoc);
    },
    [textFields, urls.documentShape],
  );

  const noteServed = useCallback((text: CollabText) => {
    servedRef.current = text;
  }, []);

  /** Seed an empty document through its shape. */
  const seedDocument = useCallback(
    (ydoc: Y.Doc, markdown: string) => {
      const registered = collabDocumentShapeById(urls.documentShape);
      if (registered) {
        registered.seed(ydoc, markdown, { origin: SEED_ORIGIN });
        return;
      }
      if (!textFields) {
        applyContentSeedToYDoc(ydoc, markdown, documentFormat);
        return;
      }
      const served = servedRef.current;
      seedTextFields(
        ydoc,
        { title: served?.title ?? urls.seedTitle ?? "", description: markdown },
        served?.etag ?? null,
      );
    },
    [documentFormat, textFields, urls.documentShape, urls.seedTitle],
  );

  const reread = useCallback(
    (
      ydoc: Y.Doc,
      stored: { update: Uint8Array | null; externalWrite?: boolean; contentTag?: string | null },
      text: CollabText,
    ): TextFieldsRereadResult => {
      const storedState = stored.update;
      servedRef.current = text;
      const result = rereadTextFields(
        ydoc,
        {
          storedState,
          externalWrite: stored.externalWrite === true,
          stateContentTag: stored.contentTag ?? null,
          text: { title: text.title ?? "", description: text.markdown },
          contentTag: text.etag ?? null,
          objectEtag: text.objectEtag ?? "",
        },
        {
          pendingLocalWork: hasPendingLocalWork(refs),
          loadedStateVector:
            loadedStateRef.current?.ydoc === ydoc ? loadedStateRef.current.stateVector : undefined,
        },
      );
      refs.externalWriteHoldRef.current = result === "prompt";
      if (result === "prompt") {
        refs.externalWriteSeenRef.current = text.etag ?? null;
        urls.onExternalWrite?.({
          markdown: text.markdown,
          title: text.title,
          serverState: storedState ?? new Uint8Array(),
          contentTag: text.etag ?? null,
          objectEtag: text.objectEtag,
        });
      }
      return result;
    },
    [loadedStateRef, refs, urls],
  );

  /**
   * The bootstrap re-read of a text-fields document. `null` when the shared
   * path runs instead: another shape, a failed text read, or a stored state
   * that did not load. An empty document with no state seeds from the served
   * text here: a task with empty notes has no seed string for the shared path,
   * and typing before a later re-read seeded it was never seeded at all. Two
   * clients' seeds of one text are byte-identical, so a peer's copy merges.
   */
  const settleBootstrap = useCallback(
    (ydoc: Y.Doc, load: BootstrapLoad): TextFieldsBootstrapSettlement | null => {
      const { snapshot } = load;
      const served = servedRef.current;
      if (!textFields || load.markdownError || !served) return null;
      const stored = snapshot.kind === "snapshot" ? snapshot : null;
      if (!stored && snapshot.kind !== "absent") return null;
      rememberSidecarEtag(room, stored?.etag ?? null);
      // A restored pending flag counts: the edit is in the local doc, not on the server.
      const pendingLocalWork = hasPendingLocalWork(refs);
      const result = reread(ydoc, stored ?? { update: null }, served);
      if (result === "prompt") return { settlement: "prompted", keptLocalEdits: pendingLocalWork };
      refs.seedDoneRef.current = true;
      // A replacement or a first seed is the server's text: nothing to save.
      // `replaced` also clears the loading status, which a 204 never would.
      if (result === "replaced" || result === "seeded")
        return { settlement: "replaced", keptLocalEdits: false };
      return { settlement: "adopted", keptLocalEdits: pendingLocalWork };
    },
    [reread, refs, room, textFields],
  );

  /**
   * The later re-read (`mergeServerState`) of a text-fields document: reads
   * `GET …/text` also on `204`. `null` for another shape. Otherwise whether
   * the document took the server's text (not when it asks the person).
   */
  const mergeTextFields = useCallback(
    async (ydoc: Y.Doc, authToken: string | undefined): Promise<boolean | null> => {
      if (!textFields) return null;
      const snapshot = await fetchYjsSnapshot(urls.yjsUrl, authToken);
      rememberSidecarEtag(room, snapshot.etag);
      const text = await loadCollabText(urls.documentUrl, authToken);
      if (refs.ydocRef.current !== ydoc) return false;
      return reread(ydoc, snapshot, text) !== "prompt";
    },
    [reread, refs, room, textFields, urls.documentUrl, urls.yjsUrl],
  );

  return { textFields, prepareDoc, noteServed, seedDocument, settleBootstrap, mergeTextFields };
}
