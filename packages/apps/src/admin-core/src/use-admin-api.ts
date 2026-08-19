import { useCallback, useMemo } from "react";
import { useWorkspaceApi } from "@/hooks/use-workspace-api";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import {
  createDefaultAdminApiSource,
  type AdminApiSource,
} from "@/admin-core/src/admin-api-source";
import { defaultMailDeliveryState } from "@/admin-core/src/admin-mail-delivery";
import type { AdminUIData } from "@/admin-core/src/admin-types";

export function useAdminAPI(source?: AdminApiSource) {
  const resolvedSource = useMemo(() => source ?? createDefaultAdminApiSource(), [source]);
  const placeholderData = useMemo<AdminUIData>(
    () => ({
      users: [],
      groups: [],
      mail: {
        imapHost: "",
        imapPort: 0,
        imapSecurity: "",
        smtpHost: "",
        smtpPort: 0,
        smtpSecurity: "",
      },
      mailDelivery: defaultMailDeliveryState(),
      rtc: {
        stunUrls: "",
        turnUrls: "",
        turnUsername: "",
        turnPassword: "",
      },
      apps: {
        calendars: true,
        contacts: true,
      },
      webdav: {
        sabreUi: true,
        timezone: "UTC",
        baseUri: "/",
        authRealm: "SabreDAV",
      },
      plugins: [],
      updates: {
        installChannel: null,
        installedVersion: "",
        schemaVersion: 0,
        latest: null,
        updateAvailable: false,
        compatible: true,
        backups: [],
        checks: [],
        inProgress: false,
        phase: null,
        current: null,
        download: null,
        phaseProgress: null,
        cancelRequested: false,
        cancelAllowed: false,
        lastCheckedAt: null,
        lastCheckError: null,
        lastResult: null,
      },
      searchReindex: {
        inProgress: false,
        phase: null,
        phaseProgress: null,
        cancelRequested: false,
        lastResult: null,
        logLines: [],
      },
      currentUser: "",
      logoutUrl: "/logout",
      updateLogLines: [],
    }),
    [],
  );
  const loadBootstrapFromSource = useCallback(
    (apiSource: AdminApiSource) => apiSource.loadBootstrap(),
    [],
  );
  const createOperationsFromSource = useCallback(
    (apiSource: AdminApiSource, bootstrap: Parameters<AdminApiSource["createOperations"]>[1]) =>
      apiSource.createOperations(apiSource, bootstrap),
    [],
  );

  const { phase, error, retry, successVersion, listLoading, session, data, operations } =
    useWorkspaceApi({
      source: resolvedSource,
      createDefaultSource: createDefaultAdminApiSource,
      placeholderData,
      loadBootstrap: loadBootstrapFromSource,
      createOperations: createOperationsFromSource,
      fallbackSession: mockWorkspaceSession,
    });

  return { phase, error, retry, successVersion, listLoading, session, data, operations };
}
