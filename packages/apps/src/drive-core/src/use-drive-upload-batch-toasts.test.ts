import { describe, expect, it } from "vitest";
import { driveUploadBatchOutcome } from "@/drive-core/src/use-drive-upload-batch-toasts";

const item = (id: string, status: "queued" | "uploading" | "failed") => ({ id, status });

describe("driveUploadBatchOutcome", () => {
  const batch = { itemIds: new Set(["a", "b", "c"]), seen: true };
  const never = () => false;

  it("waits while any file still waits or uploads", () => {
    expect(
      driveUploadBatchOutcome({ items: [item("a", "uploading")] } as never, batch, never),
    ).toBeNull();
  });

  it("does not conclude before the queue has shown the batch", () => {
    expect(
      driveUploadBatchOutcome({ items: [] } as never, { ...batch, seen: false }, never),
    ).toBeNull();
  });

  it("counts files that left the queue as uploaded, minus failures and removals", () => {
    expect(driveUploadBatchOutcome({ items: [] } as never, batch, never)).toEqual({
      uploaded: 3,
      failed: 0,
    });
    expect(
      driveUploadBatchOutcome({ items: [item("c", "failed")] } as never, batch, (id) => id === "b"),
    ).toEqual({ uploaded: 1, failed: 1 });
  });
});
