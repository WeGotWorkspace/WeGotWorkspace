export const SAVE_DELAY_MS = 2000;
/**
 * Longest a save waits after the first unsaved edit. Each edit pushes the save
 * back by SAVE_DELAY_MS, so without a cap nothing reached the server while
 * someone kept typing, and other people's lists stayed on the old text (#1533).
 */
export const SAVE_MAX_WAIT_MS = 3000;
export const SAVE_RETRY_MAX_MS = 30000;

export type SaveQueueState = {
  localDirtySinceLastSave: boolean;
  pendingServerSave: boolean;
  lastSuccessfulSaveSignature: string | null;
  saveRetryMs: number;
  nextSaveAttemptAt: number;
};

export type ShouldPersistResult = {
  shouldPersist: boolean;
  signatureChanged: boolean;
  clearLocalDirty: boolean;
  clearPendingWhenUnchanged: boolean;
};

export function computeShouldPersist(
  markdown: string,
  signature: string,
  state: Pick<
    SaveQueueState,
    "localDirtySinceLastSave" | "pendingServerSave" | "lastSuccessfulSaveSignature"
  >,
): ShouldPersistResult {
  const signatureChanged = signature !== state.lastSuccessfulSaveSignature;
  const shouldPersist =
    (state.localDirtySinceLastSave || state.pendingServerSave) && signatureChanged;
  return {
    shouldPersist,
    signatureChanged,
    clearLocalDirty: !shouldPersist,
    clearPendingWhenUnchanged: !shouldPersist && state.pendingServerSave && !signatureChanged,
  };
}

export function computeNextRetryMs(currentRetryMs: number): number {
  return Math.min(Math.max(currentRetryMs || SAVE_DELAY_MS, SAVE_DELAY_MS) * 2, SAVE_RETRY_MAX_MS);
}

/** `firstEditAt`: when the first edit since the last save was scheduled; caps the wait. */
export function computeSaveDelayMs(
  nextSaveAttemptAt: number,
  now = Date.now(),
  saveDelayMs = SAVE_DELAY_MS,
  firstEditAt: number | null = null,
): number {
  const retryDelayMs = Math.max(nextSaveAttemptAt - now, 0);
  const idleDelayMs =
    firstEditAt === null
      ? saveDelayMs
      : Math.min(saveDelayMs, Math.max(firstEditAt + SAVE_MAX_WAIT_MS - now, 0));
  return Math.max(idleDelayMs, retryDelayMs);
}

export function shouldMarkPendingWhenUnsaved(
  localDirtySinceLastSave: boolean,
  signature: string,
  lastSuccessfulSaveSignature: string | null,
): boolean {
  if (!localDirtySinceLastSave) return false;
  return signature !== lastSuccessfulSaveSignature;
}

export function createInitialSaveQueueState(): SaveQueueState {
  return {
    localDirtySinceLastSave: false,
    pendingServerSave: false,
    lastSuccessfulSaveSignature: null,
    saveRetryMs: 0,
    nextSaveAttemptAt: 0,
  };
}

export function saveSuccessState(signature: string): Partial<SaveQueueState> {
  return {
    localDirtySinceLastSave: false,
    lastSuccessfulSaveSignature: signature,
    saveRetryMs: 0,
    nextSaveAttemptAt: 0,
  };
}

export function saveFailureState(
  currentRetryMs: number,
  now = Date.now(),
): Partial<SaveQueueState> {
  const nextRetryMs = computeNextRetryMs(currentRetryMs);
  return {
    saveRetryMs: nextRetryMs,
    nextSaveAttemptAt: now + nextRetryMs,
  };
}
