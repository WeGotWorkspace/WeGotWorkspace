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
  serverPeers: [];
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
    serverPeers: [],
    warningPeers: [],
    linkCount: 0,
    status: "Disconnected",
    docStatus: "",
    pendingSync: false,
    failedSync: false,
  };
}
