import { useCallback, useEffect, useState } from "react";
import type { SettingsAPIOperations, SettingsMcpGrant } from "@/lib/models/settings-types";

export function useSettingsMcpGrants(operations?: SettingsAPIOperations, enabled = true) {
  const [grants, setGrants] = useState<SettingsMcpGrant[]>([]);
  const [loading, setLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listMcpGrants = operations?.listMcpGrants;
  const revokeMcpGrant = operations?.revokeMcpGrant;

  const refresh = useCallback(async () => {
    if (!enabled || !listMcpGrants) {
      setGrants([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setGrants(await listMcpGrants());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load AI assistants.");
    } finally {
      setLoading(false);
    }
  }, [enabled, listMcpGrants]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const revoke = useCallback(
    async (clientId: string) => {
      if (!revokeMcpGrant) return;
      setRevokingId(clientId);
      setError(null);
      try {
        await revokeMcpGrant(clientId);
        setGrants((prev) => prev.filter((grant) => grant.clientId !== clientId));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not revoke this assistant.");
      } finally {
        setRevokingId(null);
      }
    },
    [revokeMcpGrant],
  );

  /** Revokes one connection after another; stops at the first failure. */
  const revokeAll = useCallback(
    async (clientIds: readonly string[]) => {
      if (!revokeMcpGrant) return;
      setError(null);
      try {
        for (const clientId of clientIds) {
          setRevokingId(clientId);
          await revokeMcpGrant(clientId);
          setGrants((prev) => prev.filter((grant) => grant.clientId !== clientId));
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not revoke this assistant.");
      } finally {
        setRevokingId(null);
      }
    },
    [revokeMcpGrant],
  );

  return { grants, loading, revokingId, error, refresh, revoke, revokeAll };
}

export type SettingsMcpGrantsState = ReturnType<typeof useSettingsMcpGrants>;
