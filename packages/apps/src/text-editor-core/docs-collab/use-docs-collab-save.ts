import { useCallback, useRef } from "react";
import type * as Y from "yjs";
import { getConnectivitySnapshot } from "@/lib/offline/browser-online";
import { readContentFromYDoc } from "./docs-collab-editor-surface";
import { setDocsCollabSyncState } from "./docs-collab-sync-registry";
import { setCollabRoomPendingServerSave } from "./docs-collab-pending-registry";
import { clearDocsCollabPendingServerSave } from "./docs-collab-persistence";
import { markRoomServerFailure, markRoomServerSuccess } from "./docs-collab-room-backoff";
import { persistCollabSave } from "./docs-collab-save-attempt";
import {
  computeSaveDelayMs,
  computeShouldPersist,
  SAVE_DELAY_MS,
  saveFailureState,
  saveSuccessState,
  shouldMarkPendingWhenUnsaved,
} from "./docs-collab-save-queue";
import {
  DOC_STATUS_ACCESS_LOST,
  DOC_STATUS_DOCUMENT_GONE,
  DOC_STATUS_NOTE_ARCHIVED,
  DOC_STATUS_NOTE_TOO_LARGE,
} from "./docs-collab-status";
import type {
  DocsCollabSaveTerminalKind,
  DocsCollabSessionRefs,
  DocsCollabUrls,
} from "./docs-collab-types";
import {
  collabErrorStatus,
  docSignature,
  isArchivedRefusal,
  isCollabDocumentGoneError,
  isCollabPayloadTooLarge,
  isExternalWriteRefusal,
} from "./docs-collab-utils";
import { askAboutRefusedSave } from "./docs-collab-external-write-refusal";
import { PENDING_SERVER_SAVE_KEY } from "./pending-server-save-key";

type UseDocsCollabSaveOptions = {
  refs: DocsCollabSessionRefs;
  room: string;
  urls: DocsCollabUrls;
  setDocStatus: (status: string | ((prev: string) => string)) => void;
  setLastSavedAt: (iso: string | null) => void;
  setPendingSync: (pending: boolean) => void;
  setFailedSync: (failed: boolean) => void;
};

export function useDocsCollabSave({
  refs,
  room,
  urls,
  setDocStatus,
  setLastSavedAt,
  setPendingSync,
  setFailedSync,
}: UseDocsCollabSaveOptions) {
  const conflictRemergeAttemptedRef = useRef(false);

  const updatePendingState = useCallback(
    async (pending: boolean, failed = false) => {
      setPendingSync(pending);
      setFailedSync(pending && failed && getConnectivitySnapshot());
      refs.pendingServerSaveRef.current = pending;
      setCollabRoomPendingServerSave(room, pending);
      setDocsCollabSyncState(room, {
        pendingServerSave: pending,
        failedSync: pending && failed && getConnectivitySnapshot(),
      });
      const persistence = refs.persistenceRef.current;
      if (pending) {
        if (persistence) await persistence.set(PENDING_SERVER_SAVE_KEY, 1);
      } else if (persistence) {
        await persistence.del(PENDING_SERVER_SAVE_KEY);
      } else {
        await clearDocsCollabPendingServerSave(room);
      }
    },
    [refs, room, setFailedSync, setPendingSync],
  );

  const markPendingWhenUnsaved = useCallback(async (): Promise<void> => {
    const ydoc = refs.ydocRef.current;
    const getMd = refs.getMarkdownRef.current;
    if (!ydoc || !getMd || !refs.localDirtySinceLastSaveRef.current) return;
    const signature = docSignature(getMd(), ydoc);
    if (
      !shouldMarkPendingWhenUnsaved(
        refs.localDirtySinceLastSaveRef.current,
        signature,
        refs.lastSuccessfulSaveSignatureRef.current,
      )
    ) {
      return;
    }
    await updatePendingState(true, false);
  }, [refs, updatePendingState]);

  const persistToServer = useCallback(async (): Promise<void> => {
    // First, before the offline pending mark. persistCollabSave checks it too.
    if (refs.nextSaveAttemptAtRef.current === Number.POSITIVE_INFINITY) return;
    // Not on the server yet: keep the edit marked unsaved so it uploads once the
    // room is persistent (the note's create landed).
    if (urls.roomNotPersistent) {
      await markPendingWhenUnsaved();
      return;
    }
    if (refs.externalWriteHoldRef.current) return;
    if (refs.saveInFlightRef.current) return;
    if (!getConnectivitySnapshot()) {
      await markPendingWhenUnsaved();
      return;
    }
    const ydoc = refs.ydocRef.current;
    const getMd = refs.getMarkdownRef.current;
    const override = refs.markdownOverrideRef.current;
    if (!ydoc || (!getMd && override === null)) return;
    const markdown = override ?? markdownForSave(ydoc, getMd ? getMd() : "");
    const signature = docSignature(markdown, ydoc);
    const decision = computeShouldPersist(markdown, signature, {
      localDirtySinceLastSave: refs.localDirtySinceLastSaveRef.current,
      pendingServerSave: refs.pendingServerSaveRef.current,
      lastSuccessfulSaveSignature: refs.lastSuccessfulSaveSignatureRef.current,
    });
    if (!decision.shouldPersist) {
      refs.localDirtySinceLastSaveRef.current = decision.clearLocalDirty
        ? false
        : refs.localDirtySinceLastSaveRef.current;
      if (decision.clearPendingWhenUnchanged) {
        await updatePendingState(false, false);
        setDocStatus("");
      }
      return;
    }
    refs.saveInFlightRef.current = true;
    let savedMarkdown = markdown;
    try {
      const persisted = await persistCollabSave({
        urls,
        room,
        ydoc,
        markdown,
        authToken: refs.authTokenRef.current,
        remergeAttempted: conflictRemergeAttemptedRef,
        markdownAfterMerge: () => (getMd ? markdownForSave(ydoc, getMd()) : markdown),
        markdownOverrideRef: refs.markdownOverrideRef,
        externalWriteSeen: refs.externalWriteSeenRef.current,
      });
      if (persisted.status === "skipped") return;
      savedMarkdown = persisted.markdown;
      refs.externalWriteSeenRef.current = null;
      markRoomServerSuccess(room);
      refs.saveFailedRef.current = false;
      const success = saveSuccessState(docSignature(savedMarkdown, ydoc));
      refs.localDirtySinceLastSaveRef.current = success.localDirtySinceLastSave ?? false;
      refs.lastSuccessfulSaveSignatureRef.current = success.lastSuccessfulSaveSignature ?? null;
      refs.saveTerminalKindRef.current = null;
      refs.saveRetryMsRef.current = success.saveRetryMs ?? 0;
      refs.nextSaveAttemptAtRef.current = success.nextSaveAttemptAt ?? 0;
      await updatePendingState(false, false);
      setLastSavedAt(new Date().toISOString());
      setDocStatus("");
      urls.onPersistSuccess?.(savedMarkdown);
    } catch (err) {
      // Not a failure to retry: the save stays pending until a person chooses.
      if (isExternalWriteRefusal(err) && (await askAboutRefusedSave({ refs, urls }))) {
        await updatePendingState(true, false);
        setDocStatus("");
        throw err;
      }
      refs.saveFailedRef.current = true;
      const terminal = terminalSaveFailure(err);
      if (terminal) {
        refs.saveTerminalKindRef.current = terminal;
        refs.saveRetryMsRef.current = Number.POSITIVE_INFINITY;
        refs.nextSaveAttemptAtRef.current = Number.POSITIVE_INFINITY;
        // Archive wins (#1535): nothing stays pending for a later retry.
        await updatePendingState(terminal !== "archived", terminal !== "archived");
        if (terminal === "archived") {
          urls.onPersistArchived?.();
          setDocStatus(DOC_STATUS_NOTE_ARCHIVED);
        } else if (terminal === "gone") {
          urls.onDocumentGone?.();
          setDocStatus(DOC_STATUS_DOCUMENT_GONE);
        } else if (terminal === "forbidden") {
          urls.onPersistForbidden?.();
          setDocStatus(DOC_STATUS_ACCESS_LOST);
        } else {
          setDocStatus(DOC_STATUS_NOTE_TOO_LARGE);
        }
        throw err;
      }
      const failure = saveFailureState(refs.saveRetryMsRef.current);
      refs.saveRetryMsRef.current = failure.saveRetryMs ?? refs.saveRetryMsRef.current;
      refs.nextSaveAttemptAtRef.current =
        failure.nextSaveAttemptAt ?? refs.nextSaveAttemptAtRef.current;
      if (getConnectivitySnapshot()) {
        markRoomServerFailure(room);
      }
      await updatePendingState(true, true);
      setDocStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    } finally {
      refs.saveInFlightRef.current = false;
    }
  }, [markPendingWhenUnsaved, refs, room, setDocStatus, setLastSavedAt, updatePendingState, urls]);

  // A failed save re-arms itself with the backoff already set. Without this a
  // transient 5xx left the body unsaved until the next keystroke or reload.
  // Terminal failures set the next attempt to infinity, so they stop here.
  const scheduleSave: () => void = useCallback(() => {
    if (refs.nextSaveAttemptAtRef.current === Number.POSITIVE_INFINITY) return;
    if (!refs.localDirtySinceLastSaveRef.current && !refs.pendingServerSaveRef.current) return;
    if (refs.saveTimerRef.current) clearTimeout(refs.saveTimerRef.current);
    const delayMs = computeSaveDelayMs(refs.nextSaveAttemptAtRef.current);
    refs.saveTimerRef.current = setTimeout(() => {
      refs.saveTimerRef.current = null;
      void persistToServer().catch(() => scheduleSave());
    }, delayMs);
  }, [persistToServer, refs]);

  const flushPendingSaveIfReady = useCallback(() => {
    if (!refs.pendingServerSaveRef.current || !getConnectivitySnapshot()) return;
    if (refs.saveTimerRef.current) clearTimeout(refs.saveTimerRef.current);
    refs.saveTimerRef.current = setTimeout(() => {
      refs.saveTimerRef.current = null;
      void persistToServer().catch(() => scheduleSave());
    }, 0);
  }, [persistToServer, refs, scheduleSave]);

  const registerMarkdownGetter = useCallback(
    (getMarkdown: () => string) => {
      refs.getMarkdownRef.current = getMarkdown;
      flushPendingSaveIfReady();
      // A title edit can land before the editor binds its markdown getter.
      if (refs.localDirtySinceLastSaveRef.current) scheduleSave();
    },
    [flushPendingSaveIfReady, refs, scheduleSave],
  );

  const saveNow = useCallback(async () => {
    if (refs.saveTimerRef.current) clearTimeout(refs.saveTimerRef.current);
    await persistToServer();
  }, [persistToServer, refs]);

  const onMarkdownChange = useCallback(
    (getMarkdown: () => string) => {
      refs.getMarkdownRef.current = getMarkdown;
      const nextMarkdown = getMarkdown();
      // The Y.Doc listener already marks a local edit dirty. An edit back to
      // the last known text (a note opened offline and emptied) still saves.
      const changed = nextMarkdown !== refs.lastKnownMarkdownRef.current;
      if (!changed && !refs.localDirtySinceLastSaveRef.current) return;
      refs.lastKnownMarkdownRef.current = nextMarkdown;
      refs.localDirtySinceLastSaveRef.current = true;
      if (!getConnectivitySnapshot()) {
        void markPendingWhenUnsaved();
      }
      scheduleSave();
    },
    [markPendingWhenUnsaved, refs, scheduleSave],
  );

  return {
    updatePendingState,
    markPendingWhenUnsaved,
    persistToServer,
    scheduleSave,
    flushPendingSaveIfReady,
    registerMarkdownGetter,
    saveNow,
    onMarkdownChange,
  };
}

export { SAVE_DELAY_MS };

function terminalSaveFailure(error: unknown): DocsCollabSaveTerminalKind | null {
  if (isArchivedRefusal(error)) return "archived";
  if (isCollabDocumentGoneError(error)) return "gone";
  if (collabErrorStatus(error) === 403) return "forbidden";
  if (isCollabPayloadTooLarge(error)) return "too-large";
  return null;
}

/**
 * A reconnect can apply the server Y.Doc before the editor view catches up.
 * Saving the shorter view would replace the other person's edit.
 */
function markdownForSave(ydoc: Y.Doc, editorMarkdown: string): string {
  try {
    const fromDoc = readContentFromYDoc(ydoc);
    if (
      editorMarkdown !== "" &&
      fromDoc.includes(editorMarkdown) &&
      fromDoc.length > editorMarkdown.length
    ) {
      return fromDoc;
    }
  } catch {
    // The editor string is still a valid save body.
  }
  return editorMarkdown;
}
