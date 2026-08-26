import { useCallback, useMemo } from "react";
import { useWorkspaceApi } from "@/hooks/use-workspace-api";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { createDefaultMeetApiSource, type MeetApiSource } from "@/meet-core/src/meet-api-source";
import type { MeetAppBootstrap, MeetUIData } from "@/meet-core/src/meet-types";

export function useMeetAPI(source?: MeetApiSource) {
  const resolvedSource = useMemo(() => source ?? createDefaultMeetApiSource(), [source]);
  const placeholderData = useMemo<MeetUIData>(
    () => ({
      defaultDisplayName: "Guest",
      rtc: {
        stunUrls: "",
        turnUrls: "",
        turnUsername: "",
        turnPassword: "",
        forceRelay: false,
      },
    }),
    [],
  );
  const loadBootstrapFromSource = useCallback(
    (apiSource: MeetApiSource) => apiSource.loadBootstrap(),
    [],
  );
  const createOperationsFromSource = useCallback(
    (apiSource: MeetApiSource, bootstrap?: MeetAppBootstrap) =>
      apiSource.createOperations(bootstrap),
    [],
  );
  const { phase, error, retry, successVersion, listLoading, session, data, operations } =
    useWorkspaceApi({
      source: resolvedSource,
      createDefaultSource: createDefaultMeetApiSource,
      placeholderData,
      loadBootstrap: loadBootstrapFromSource,
      createOperations: createOperationsFromSource,
      fallbackSession: mockWorkspaceSession,
    });

  return {
    phase,
    error,
    retry,
    successVersion,
    listLoading,
    session,
    data,
    operations,
  };
}
