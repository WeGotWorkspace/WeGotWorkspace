import { describe, expect, it } from "vitest";
import {
  computeNextRetryMs,
  computeSaveDelayMs,
  computeShouldPersist,
  SAVE_DELAY_MS,
  SAVE_MAX_WAIT_MS,
  SAVE_RETRY_MAX_MS,
  shouldMarkPendingWhenUnsaved,
} from "./docs-collab-save-queue";

describe("docs-collab-save-queue", () => {
  it("persists when dirty and signature changed", () => {
    const result = computeShouldPersist("# edit", "sig-new", {
      localDirtySinceLastSave: true,
      pendingServerSave: false,
      lastSuccessfulSaveSignature: "sig-old",
    });
    expect(result.shouldPersist).toBe(true);
    expect(result.signatureChanged).toBe(true);
  });

  it("skips persist when signature unchanged", () => {
    const result = computeShouldPersist("# same", "sig-same", {
      localDirtySinceLastSave: true,
      pendingServerSave: false,
      lastSuccessfulSaveSignature: "sig-same",
    });
    expect(result.shouldPersist).toBe(false);
    expect(result.clearLocalDirty).toBe(true);
  });

  it("clears pending when signature unchanged but pending flag set", () => {
    const result = computeShouldPersist("# same", "sig-same", {
      localDirtySinceLastSave: false,
      pendingServerSave: true,
      lastSuccessfulSaveSignature: "sig-same",
    });
    expect(result.clearPendingWhenUnchanged).toBe(true);
  });

  it("computes retry delay with doubling cap", () => {
    expect(computeNextRetryMs(0)).toBe(SAVE_DELAY_MS * 2);
    expect(computeNextRetryMs(SAVE_RETRY_MAX_MS)).toBe(SAVE_RETRY_MAX_MS);
  });

  it("computeSaveDelayMs respects retry backoff", () => {
    const now = 1000;
    expect(computeSaveDelayMs(now + 5000, now)).toBe(5000);
    expect(computeSaveDelayMs(now, now)).toBe(SAVE_DELAY_MS);
  });

  it("computeSaveDelayMs caps the wait since the first edit at SAVE_MAX_WAIT_MS", () => {
    const now = 10_000;
    expect(computeSaveDelayMs(0, now, SAVE_DELAY_MS, now)).toBe(SAVE_DELAY_MS);
    expect(computeSaveDelayMs(0, now, SAVE_DELAY_MS, now - 2500)).toBe(SAVE_MAX_WAIT_MS - 2500);
    expect(computeSaveDelayMs(0, now, SAVE_DELAY_MS, now - 9000)).toBe(0);
    // The retry backoff still wins over the cap.
    expect(computeSaveDelayMs(now + 5000, now, SAVE_DELAY_MS, now - 9000)).toBe(5000);
  });

  it("shouldMarkPendingWhenUnsaved requires dirty + changed signature", () => {
    expect(shouldMarkPendingWhenUnsaved(true, "a", "b")).toBe(true);
    expect(shouldMarkPendingWhenUnsaved(false, "a", "b")).toBe(false);
    expect(shouldMarkPendingWhenUnsaved(true, "a", "a")).toBe(false);
  });
});
