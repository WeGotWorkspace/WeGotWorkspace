import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DriveUploadBatchDialogProps,
  DriveUploadBatchRequest,
} from "@/drive-core/src/drive-upload-batch-dialog";
import { useDriveUploadQueue } from "@/drive-core/src/drive-upload-queue";
import type { DriveAPIOperations, DriveUploadBatchAnswers } from "@/drive-core/src/drive-types";
import { hasDriveUploadBatchQuestions } from "@/lib/offline/drive/upload/drive-upload-batch-questions";
import { stopAskingUploadBatch } from "@/lib/offline/drive/upload/drive-upload-memory";

type BatchDialogOperations = Pick<
  DriveAPIOperations,
  "releaseUploadBatch" | "cancelUploadBatch" | "claimUnansweredUploadBatches" | "watchUploadQueue"
>;

/**
 * The batches this tab asks about, one dialog at a time. On load it takes
 * over batches a closed or reloaded tab left waiting for an answer, and it
 * drops a request once its batch was answered or cancelled elsewhere.
 * `onRelease` runs right before a batch goes to the uploader.
 */
export function useDriveUploadBatchDialog(
  operations: BatchDialogOperations | undefined,
  showError: (message: string) => void,
  onRelease: (request: Pick<DriveUploadBatchRequest, "batchId" | "itemIds">) => void,
) {
  const [requests, setRequests] = useState<DriveUploadBatchRequest[]>([]);
  /** Batches a snapshot has shown waiting: from then on, not waiting means answered. */
  const seenWaiting = useRef(new Set<string>());
  const snapshot = useDriveUploadQueue(operations);
  const release = operations?.releaseUploadBatch;
  const cancel = operations?.cancelUploadBatch;
  const claim = operations?.claimUnansweredUploadBatches;
  const hasClaim = Boolean(claim);
  // The latest `claim`: it changes identity whenever the operations are rebuilt.
  const claimRef = useRef(claim);
  claimRef.current = claim;
  const requestsRef = useRef(requests);
  requestsRef.current = requests;
  const mounted = useRef(false);

  const reportError = useCallback(
    (error: unknown) => showError(error instanceof Error ? error.message : String(error)),
    [showError],
  );

  const releaseBatch = useCallback(
    (
      request: Pick<DriveUploadBatchRequest, "batchId" | "itemIds">,
      answers: DriveUploadBatchAnswers,
    ) => {
      if (!release) return;
      onRelease(request);
      void release(request.batchId, answers).catch(reportError);
    },
    [onRelease, release, reportError],
  );

  const ask = useCallback((request: DriveUploadBatchRequest) => {
    setRequests((previous) => [...previous, request]);
  }, []);

  // Gone with the hook: stop answering probes for the batches asked here, so
  // another tab (or the next mount) takes them over.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const request of requestsRef.current) stopAskingUploadBatch(request.batchId);
    };
  }, []);

  // Once per Drive load, not per rebuilt `claim`: a claim marks its batches as
  // asked, so its result must never be dropped. Later batches come through `ask`.
  useEffect(() => {
    const claimBatches = claimRef.current;
    if (!claimBatches) return;
    void claimBatches()
      .then((claimed) => {
        for (const request of claimed) {
          if (!mounted.current) stopAskingUploadBatch(request.batchId);
          else if (hasDriveUploadBatchQuestions(request.questions)) ask(request);
          else releaseBatch(request, { keepOffline: "remove" });
        }
      })
      .catch(reportError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasClaim]);

  // Answered or cancelled in another tab: close it here too.
  useEffect(() => {
    if (!snapshot) return;
    const waiting = new Set(
      snapshot.batches.filter((b) => b.status === "awaiting_input").map((b) => b.id),
    );
    for (const id of waiting) seenWaiting.current.add(id);
    setRequests((previous) => {
      const next = previous.filter(
        (request) => waiting.has(request.batchId) || !seenWaiting.current.has(request.batchId),
      );
      return next.length === previous.length ? previous : next;
    });
  }, [snapshot]);

  const settle = (batchId: string) =>
    setRequests((previous) => previous.filter((request) => request.batchId !== batchId));

  const current = requests[0] ?? null;
  const dialog: DriveUploadBatchDialogProps = {
    request: current,
    onCancel: (batchId) => {
      settle(batchId);
      void cancel?.(batchId).catch(reportError);
    },
    onUpload: (batchId, answers) => {
      settle(batchId);
      releaseBatch(
        { batchId, itemIds: current?.batchId === batchId ? current.itemIds : [] },
        answers,
      );
    },
  };

  return { ask, dialog };
}
