import { useCallback, useMemo } from "react";
import { useWorkspaceApi } from "@/hooks/use-workspace-api";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import {
  createDefaultSpreadsheetApiSource,
  type SpreadsheetApiSource,
} from "@/spreadsheet-core/src/spreadsheet-api-source";
import type { SpreadsheetUIData } from "@/spreadsheet-core/src/spreadsheet-types";

export function useSpreadsheetAPI(source?: SpreadsheetApiSource) {
  const resolvedSource = useMemo(() => source ?? createDefaultSpreadsheetApiSource(), [source]);
  const placeholderData = useMemo<SpreadsheetUIData>(() => ({ document: null }), []);
  const loadBootstrapFromSource = useCallback(
    (apiSource: SpreadsheetApiSource) => apiSource.loadBootstrap(),
    [],
  );
  const createOperationsFromSource = useCallback(
    (apiSource: SpreadsheetApiSource) => apiSource.createOperations(),
    [],
  );

  const { phase, error, retry, successVersion, listLoading, session, data, operations } =
    useWorkspaceApi({
      source: resolvedSource,
      createDefaultSource: createDefaultSpreadsheetApiSource,
      placeholderData,
      loadBootstrap: loadBootstrapFromSource,
      createOperations: createOperationsFromSource,
      fallbackSession: mockWorkspaceSession,
    });

  return { phase, error, retry, successVersion, listLoading, session, data, operations };
}
