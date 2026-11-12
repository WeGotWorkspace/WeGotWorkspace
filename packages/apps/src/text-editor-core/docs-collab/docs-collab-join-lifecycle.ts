import type { DocsCollabSessionRefs } from "./docs-collab-types";

export type JoinGenerationRefs = {
  joinGeneration: number;
  reconnectGeneration: number;
};

export function isJoinGenerationCurrent(
  generation: number,
  joinGenerationRef: { current: number },
): boolean {
  return generation === joinGenerationRef.current;
}

export function isReconnectGenerationCurrent(
  generation: number,
  reconnectGenerationRef: { current: number },
): boolean {
  return generation === reconnectGenerationRef.current;
}

export function bumpJoinGeneration(joinGenerationRef: { current: number }): number {
  return ++joinGenerationRef.current;
}

export function bumpReconnectGeneration(reconnectGenerationRef: { current: number }): number {
  return ++reconnectGenerationRef.current;
}

export type TeardownResetState = {
  seedDone: boolean;
  localDirtySinceLastSave: boolean;
  pendingServerSave: boolean;
  lastKnownMarkdown: string;
  lastSuccessfulSaveSignature: string | null;
  saveFailed: boolean;
  saveInFlight: boolean;
  saveRetryMs: number;
  nextSaveAttemptAt: number;
  saveTerminalKind: null;
  reconnectInFlight: boolean;
  joinedRoom: string | null;
  authToken: string | undefined;
};

export function createTeardownResetState(): TeardownResetState {
  return {
    seedDone: false,
    localDirtySinceLastSave: false,
    pendingServerSave: false,
    lastKnownMarkdown: "",
    lastSuccessfulSaveSignature: null,
    saveFailed: false,
    saveInFlight: false,
    saveRetryMs: 0,
    nextSaveAttemptAt: 0,
    saveTerminalKind: null,
    reconnectInFlight: false,
    joinedRoom: null,
    authToken: undefined,
  };
}

export const TEARDOWN_TIMER_KEYS = ["saveTimer", "seedTimer"] as const;

export type TeardownUiReset = {
  session: null;
  joined: false;
  peers: [];
  connectingPeers: [];
  warningPeers: [];
  linkCount: 0;
  status: "Disconnected";
  docStatus: "";
  pendingSync: false;
  failedSync: false;
};

export function createTeardownUiReset(): TeardownUiReset {
  return {
    session: null,
    joined: false,
    peers: [],
    connectingPeers: [],
    warningPeers: [],
    linkCount: 0,
    status: "Disconnected",
    docStatus: "",
    pendingSync: false,
    failedSync: false,
  };
}

type TeardownRefs = Pick<
  DocsCollabSessionRefs,
  | "seedDoneRef"
  | "localDirtySinceLastSaveRef"
  | "pendingServerSaveRef"
  | "externalWriteHoldRef"
  | "externalWriteSeenRef"
  | "markdownOverrideRef"
  | "lastKnownMarkdownRef"
  | "lastSuccessfulSaveSignatureRef"
  | "saveFailedRef"
  | "saveInFlightRef"
  | "saveRetryMsRef"
  | "nextSaveAttemptAtRef"
  | "saveTerminalKindRef"
  | "reconnectInFlightRef"
  | "joinedRoomRef"
  | "authTokenRef"
>;

/** Put a session's refs back to their state before the first join. */
export function resetSessionRefsForTeardown(refs: TeardownRefs): void {
  const reset = createTeardownResetState();
  refs.seedDoneRef.current = reset.seedDone;
  refs.localDirtySinceLastSaveRef.current = reset.localDirtySinceLastSave;
  refs.pendingServerSaveRef.current = reset.pendingServerSave;
  refs.externalWriteHoldRef.current = false;
  refs.externalWriteSeenRef.current = null;
  refs.markdownOverrideRef.current = null;
  refs.lastKnownMarkdownRef.current = reset.lastKnownMarkdown;
  refs.lastSuccessfulSaveSignatureRef.current = reset.lastSuccessfulSaveSignature;
  refs.saveFailedRef.current = reset.saveFailed;
  refs.saveInFlightRef.current = reset.saveInFlight;
  refs.saveRetryMsRef.current = reset.saveRetryMs;
  refs.nextSaveAttemptAtRef.current = reset.nextSaveAttemptAt;
  refs.saveTerminalKindRef.current = reset.saveTerminalKind;
  refs.reconnectInFlightRef.current = reset.reconnectInFlight;
  refs.joinedRoomRef.current = reset.joinedRoom;
  refs.authTokenRef.current = reset.authToken;
}
