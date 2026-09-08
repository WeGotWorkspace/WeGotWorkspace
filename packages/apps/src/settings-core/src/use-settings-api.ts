import { useCallback, useMemo } from "react";
import { useWorkspaceApi } from "@/hooks/use-workspace-api";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import {
  createDefaultSettingsApiSource,
  type SettingsApiSource,
} from "@/settings-core/src/settings-api-source";
import type { SettingsAPIOperations, SettingsUIData } from "@/settings-core/src/settings-types";

export function useSettingsAPI(source?: SettingsApiSource) {
  const resolvedSource = useMemo(() => source ?? createDefaultSettingsApiSource(), [source]);
  const placeholderData = useMemo<SettingsUIData>(
    () => ({
      user: { username: "", displayName: "", email: "" },
      groups: [],
      mail: { imapUsername: "", imapHasPassword: false },
      mailServer: {
        imapHost: "",
        imapPort: 0,
        imapSecurity: "",
        smtpHost: "",
        smtpPort: 0,
        smtpSecurity: "",
      },
      logoutUrl: "/logout",
    }),
    [],
  );
  const loadBootstrapFromSource = useCallback(
    (apiSource: SettingsApiSource) => apiSource.loadBootstrap(),
    [],
  );
  const createOperationsFromSource = useCallback(
    (apiSource: SettingsApiSource) => apiSource.createOperations(),
    [],
  );

  const {
    phase,
    error,
    retry,
    successVersion,
    listLoading,
    session,
    data,
    operations: baseOperations,
    patchBootstrap,
  } = useWorkspaceApi({
    source: resolvedSource,
    createDefaultSource: createDefaultSettingsApiSource,
    placeholderData,
    loadBootstrap: loadBootstrapFromSource,
    createOperations: createOperationsFromSource,
    fallbackSession: mockWorkspaceSession,
  });

  const operations = useMemo(() => {
    if (!baseOperations) {
      return undefined;
    }

    const applySettingsState = (next: SettingsUIData) => {
      patchBootstrap((prev) => {
        if (!prev) {
          return prev;
        }

        return {
          ...prev,
          data: next,
          session: {
            ...prev.session,
            user: {
              ...prev.session.user,
              displayName: next.user.displayName,
              email: next.user.email,
            },
          },
        };
      });
    };

    const operations: SettingsAPIOperations = {
      saveProfile: async (input, opts) => {
        const next = await baseOperations.saveProfile(input, opts);
        applySettingsState(next);
        return next;
      },
      saveMail: async (input, opts) => {
        const next = await baseOperations.saveMail(input, opts);
        applySettingsState(next);
        return next;
      },
      listMcpGrants: baseOperations.listMcpGrants,
      revokeMcpGrant: baseOperations.revokeMcpGrant,
    };
    return operations;
  }, [baseOperations, patchBootstrap]);

  return { phase, error, retry, successVersion, listLoading, session, data, operations };
}
