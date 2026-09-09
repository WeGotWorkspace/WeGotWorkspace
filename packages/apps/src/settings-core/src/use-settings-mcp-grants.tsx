import { useCallback, useEffect, useState } from "react";
import type { SettingsAPIOperations, SettingsMcpGrant } from "@/settings-core/src/settings-types";

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
      setError(cause instanceof Error ? cause.message : "Could not load connected assistants.");
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

  return { grants, loading, revokingId, error, refresh, revoke };
}

export type SettingsMcpGrantsState = ReturnType<typeof useSettingsMcpGrants>;
