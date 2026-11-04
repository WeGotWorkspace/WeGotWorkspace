import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDriveUploadBatchDialog } from "@/drive-core/src/use-drive-upload-batch-dialog";
import {
  isAskingUploadBatchHere,
  startAskingUploadBatch,
  stopAskingUploadBatch,
} from "@/lib/offline/drive/upload/drive-upload-memory";

const request = {
  batchId: "batch-1",
  itemIds: ["item-1"],
  questions: { space: null, conflicts: null, keepOffline: { count: 1 } },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function operations(claim: () => Promise<unknown[]>) {
  return {
    releaseUploadBatch: vi.fn().mockResolvedValue(undefined),
    cancelUploadBatch: vi.fn().mockResolvedValue(undefined),
    claimUnansweredUploadBatches: claim,
    watchUploadQueue: () => () => {},
  } as never;
}

describe("useDriveUploadBatchDialog", () => {
  afterEach(() => {
    cleanup();
    stopAskingUploadBatch("batch-1");
  });

  it("still asks a claimed batch when the operations are rebuilt while the claim is pending", async () => {
    const first = deferred<unknown[]>();
    const second = vi.fn().mockResolvedValue([]);
    const showError = vi.fn();
    const onRelease = vi.fn();
    const { result, rerender } = renderHook(
      ({ ops }) => useDriveUploadBatchDialog(ops, showError, onRelease),
      { initialProps: { ops: operations(() => first.promise) } },
    );
    rerender({ ops: operations(second) });
    first.resolve([request]);
    await waitFor(() => expect(result.current.dialog.request?.batchId).toBe("batch-1"));
    expect(second).not.toHaveBeenCalled();
  });

  it("stops asking for its open batches when it unmounts", async () => {
    const { result, unmount } = renderHook(() =>
      useDriveUploadBatchDialog(
        operations(async () => {
          startAskingUploadBatch("batch-1");
          return [request];
        }),
        vi.fn(),
        vi.fn(),
      ),
    );
    await waitFor(() => expect(result.current.dialog.request).not.toBeNull());
    expect(isAskingUploadBatchHere("batch-1")).toBe(true);
    unmount();
    expect(isAskingUploadBatchHere("batch-1")).toBe(false);
  });
});
