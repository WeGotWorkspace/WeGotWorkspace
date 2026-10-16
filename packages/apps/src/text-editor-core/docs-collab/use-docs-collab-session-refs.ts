import { useEffect, useRef } from "react";
import type { DocsCollabSession, DocsCollabSessionRefs } from "./docs-collab-types";
import type { DocsCollabWireOperations } from "./docs-collab-wire";

export function useDocsCollabSessionRefs(
  wire: DocsCollabWireOperations,
  seedContent: string | undefined,
): DocsCollabSessionRefs {
  const meshRef = useRef<import("./docs-rtc-session").DocsRtcSession | null>(null);
  const ydocRef = useRef<import("yjs").Doc | null>(null);
  const awarenessRef = useRef<import("y-protocols/awareness").Awareness | null>(null);
  const persistenceRef = useRef<import("y-indexeddb").IndexeddbPersistence | null>(null);
  const pendingMarkdownRef = useRef("");
  const seedDoneRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getMarkdownRef = useRef<(() => string) | null>(null);
  const joinGenerationRef = useRef(0);
  const reconnectGenerationRef = useRef(0);
  const authTokenRef = useRef<string | undefined>(undefined);
  const failedSinceRef = useRef<Map<string, number>>(new Map());
  const saveFailedRef = useRef(false);
  const wireRef = useRef(wire);
  const seedContentRef = useRef(seedContent);
  const joinedRoomRef = useRef<string | null>(null);
  const reconnectInFlightRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const saveRetryMsRef = useRef(0);
  const nextSaveAttemptAtRef = useRef(0);
  const saveTerminalKindRef = useRef<
    import("./docs-collab-types").DocsCollabSaveTerminalKind | null
  >(null);
  const localDirtySinceLastSaveRef = useRef(false);
  const pendingServerSaveRef = useRef(false);
  const externalWriteHoldRef = useRef(false);
  const markdownOverrideRef = useRef<string | null>(null);
  const lastKnownMarkdownRef = useRef("");
  const lastSuccessfulSaveSignatureRef = useRef<string | null>(null);
  const sessionRef = useRef<DocsCollabSession | null>(null);
  const tabSyncRef = useRef<import("./docs-collab-types").DocsCollabTabSyncApi | null>(null);

  const refsBag = useRef<DocsCollabSessionRefs | null>(null);
  if (!refsBag.current) {
    refsBag.current = {
      meshRef,
      ydocRef,
      awarenessRef,
      persistenceRef,
      pendingMarkdownRef,
      seedDoneRef,
      saveTimerRef,
      seedTimerRef,
      getMarkdownRef,
      joinGenerationRef,
      reconnectGenerationRef,
      authTokenRef,
      failedSinceRef,
      saveFailedRef,
      wireRef,
      seedContentRef,
      joinedRoomRef,
      reconnectInFlightRef,
      saveInFlightRef,
      saveRetryMsRef,
      nextSaveAttemptAtRef,
      saveTerminalKindRef,
      localDirtySinceLastSaveRef,
      pendingServerSaveRef,
      externalWriteHoldRef,
      markdownOverrideRef,
      lastKnownMarkdownRef,
      lastSuccessfulSaveSignatureRef,
      sessionRef,
      tabSyncRef,
    };
  }

  useEffect(() => {
    wireRef.current = wire;
  }, [wire]);

  useEffect(() => {
    seedContentRef.current = seedContent;
  }, [seedContent]);

  return refsBag.current;
}
