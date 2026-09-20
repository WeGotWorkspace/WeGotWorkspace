import { useCallback, useMemo } from "react";
import { useWorkspaceApi } from "@/hooks/use-workspace-api";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import {
  createDefaultInstallerApiSource,
  type InstallerApiSource,
} from "@/installer-core/src/installer-api-source";
import type { InstallerUIData } from "@/installer-core/src/installer-types";

export function useInstallerAPI(source?: InstallerApiSource) {
  const resolvedSource = useMemo(() => source ?? createDefaultInstallerApiSource(), [source]);
  const placeholderData = useMemo<InstallerUIData>(() => ({ state: null }), []);
  const loadBootstrapFromSource = useCallback(
    (apiSource: InstallerApiSource) => apiSource.loadBootstrap(),
    [],
  );
  const createOperationsFromSource = useCallback(
    (
      apiSource: InstallerApiSource,
      bootstrap: Parameters<InstallerApiSource["createOperations"]>[1],
    ) => apiSource.createOperations(apiSource, bootstrap),
    [],
  );

  const { phase, error, retry, successVersion, listLoading, session, data, operations } =
    useWorkspaceApi({
      source: resolvedSource,
      createDefaultSource: createDefaultInstallerApiSource,
      placeholderData,
      loadBootstrap: loadBootstrapFromSource,
      createOperations: createOperationsFromSource,
      fallbackSession: mockWorkspaceSession,
    });

  return { phase, error, retry, successVersion, listLoading, session, data, operations };
}
