import { useCallback, useRef } from "react";
import { getConnectivitySnapshot } from "@/lib/offline/browser-online";
import { reportDocsSyncConflicts } from "@/lib/offline/docs/docs-sync-conflicts";
import { setDocsCollabSyncState } from "./docs-collab-sync-registry";
import { clearDocsCollabPendingServerSave } from "./docs-collab-persistence";
import { markRoomServerFailure, markRoomServerSuccess } from "./docs-collab-room-backoff";
import { loadYjsSnapshot, saveDocument } from "./docs-collab-server-io";
import {
  computeSaveDelayMs,
  computeShouldPersist,
  SAVE_DELAY_MS,
  saveFailureState,
  saveSuccessState,
  shouldMarkPendingWhenUnsaved,
} from "./docs-collab-save-queue";
import { formatSavedDocStatus } from "./docs-collab-status";
import type { DocsCollabSessionRefs, DocsCollabUrls } from "./docs-collab-types";
import { docSignature, isCollabPayloadTooLarge, SERVER_ORIGIN } from "./docs-collab-utils";

function isServerDivergenceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\((409|412)\)/.test(message) || /precondition failed/i.test(message);
}

export const PENDING_SERVER_SAVE_KEY = "pendingServerSave";

type UseDocsCollabSaveOptions = {
  refs: DocsCollabSessionRefs;
  room: string;
  urls: DocsCollabUrls;
  setDocStatus: (status: string | ((prev: string) => string)) => void;
  setPendingSync: (pending: boolean) => void;
  setFailedSync: (failed: boolean) => void;
};

export function useDocsCollabSave({
  refs,
  room,
  urls,
  setDocStatus,
  setPendingSync,
  setFailedSync,
}: UseDocsCollabSaveOptions) {
  const conflictRemergeAttemptedRef = useRef(false);

  const updatePendingState = useCallback(
    async (pending: boolean, failed = false) => {
      setPendingSync(pending);
      setFailedSync(pending && failed && getConnectivitySnapshot());
      refs.pendingServerSaveRef.current = pending;
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
    if (refs.saveInFlightRef.current) return;
    if (!getConnectivitySnapshot()) {
      await markPendingWhenUnsaved();
      return;
    }
    const ydoc = refs.ydocRef.current;
    const getMd = refs.getMarkdownRef.current;
    if (!ydoc || !getMd) return;
    const markdown = getMd();
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
    try {
      const attemptSave = async () => {
        if (urls.persistMarkdown) {
          await urls.persistMarkdown(markdown, refs.authTokenRef.current);
          return;
        }
        await saveDocument(
          urls.documentUrl,
          markdown,
          ydoc,
          urls.room,
          refs.authTokenRef.current,
          urls.documentSaveMethod === "PATCH" ? "PUT" : (urls.documentSaveMethod ?? "POST"),
        );
      };

      try {
        await attemptSave();
      } catch (firstError) {
        if (
          isServerDivergenceError(firstError) &&
          !conflictRemergeAttemptedRef.current &&
          getConnectivitySnapshot()
        ) {
          conflictRemergeAttemptedRef.current = true;
          const merged = await loadYjsSnapshot(
            urls.yjsUrl,
            ydoc,
            refs.authTokenRef.current,
            SERVER_ORIGIN,
          );
          if (merged) {
            const remergedMarkdown = getMd();
            await saveDocument(
              urls.documentUrl,
              remergedMarkdown,
              ydoc,
              urls.room,
              refs.authTokenRef.current,
              urls.documentSaveMethod ?? "POST",
            );
          } else {
            throw firstError;
          }
        } else {
          throw firstError;
        }
      }

      conflictRemergeAttemptedRef.current = false;
      markRoomServerSuccess(room);
      refs.saveFailedRef.current = false;
      const success = saveSuccessState(signature);
      refs.localDirtySinceLastSaveRef.current = success.localDirtySinceLastSave ?? false;
      refs.lastSuccessfulSaveSignatureRef.current = success.lastSuccessfulSaveSignature ?? null;
      refs.saveRetryMsRef.current = success.saveRetryMs ?? 0;
      refs.nextSaveAttemptAtRef.current = success.nextSaveAttemptAt ?? 0;
      await updatePendingState(false, false);
      setDocStatus(formatSavedDocStatus());
    } catch (err) {
      refs.saveFailedRef.current = true;
      if (
        urls.onPersistForbidden &&
        /\(403\)/.test(err instanceof Error ? err.message : String(err))
      ) {
        urls.onPersistForbidden();
      }
      if (isServerDivergenceError(err) && getConnectivitySnapshot()) {
        reportDocsSyncConflicts([room]);
      }
      if (isCollabPayloadTooLarge(err)) {
        refs.saveRetryMsRef.current = Number.POSITIVE_INFINITY;
        refs.nextSaveAttemptAtRef.current = Number.POSITIVE_INFINITY;
        await updatePendingState(true, true);
        setDocStatus("This note is too large to save.");
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
  }, [markPendingWhenUnsaved, refs, room, setDocStatus, updatePendingState, urls]);

  const scheduleSave = useCallback(() => {
    if (refs.nextSaveAttemptAtRef.current === Number.POSITIVE_INFINITY) return;
    if (!refs.localDirtySinceLastSaveRef.current && !refs.pendingServerSaveRef.current) return;
    if (refs.saveTimerRef.current) clearTimeout(refs.saveTimerRef.current);
    const delayMs = computeSaveDelayMs(refs.nextSaveAttemptAtRef.current);
    refs.saveTimerRef.current = setTimeout(() => {
      refs.saveTimerRef.current = null;
      void persistToServer().catch(() => undefined);
    }, delayMs);
  }, [persistToServer, refs]);

  const flushPendingSaveIfReady = useCallback(() => {
    if (!refs.pendingServerSaveRef.current || !getConnectivitySnapshot()) return;
    if (refs.saveTimerRef.current) clearTimeout(refs.saveTimerRef.current);
    refs.saveTimerRef.current = setTimeout(() => {
      refs.saveTimerRef.current = null;
      void persistToServer().catch(() => undefined);
    }, 0);
  }, [persistToServer, refs]);

  const registerMarkdownGetter = useCallback(
    (getMarkdown: () => string) => {
      refs.getMarkdownRef.current = getMarkdown;
      flushPendingSaveIfReady();
    },
    [flushPendingSaveIfReady, refs],
  );

  const saveNow = useCallback(async () => {
    if (refs.saveTimerRef.current) clearTimeout(refs.saveTimerRef.current);
    await persistToServer();
  }, [persistToServer, refs]);

  const onMarkdownChange = useCallback(
    (getMarkdown: () => string) => {
      refs.getMarkdownRef.current = getMarkdown;
      const nextMarkdown = getMarkdown();
      if (nextMarkdown === refs.lastKnownMarkdownRef.current) return;
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
