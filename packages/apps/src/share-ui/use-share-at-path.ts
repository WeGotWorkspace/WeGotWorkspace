import { useCallback, useEffect, useRef, useState } from "react";
import type { DriveShareAtPath } from "@wgw-api-generated/drive-types";
import type { DriveShareOperations } from "@/drive-core/src/drive-types";

type UseShareAtPathArgs = {
  path: string;
  operations: DriveShareOperations;
  enabled?: boolean;
};

export function useShareAtPath({ path, operations, enabled = true }: UseShareAtPathArgs) {
  const [data, setData] = useState<DriveShareAtPath | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await operations.getAtPath(path);
      if (requestId !== requestIdRef.current) return result;
      setData(result);
      return result;
    } catch (cause) {
      if (requestId !== requestIdRef.current) return null;
      const message = cause instanceof Error ? cause.message : "Failed to load share data";
      setError(message);
      return null;
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [operations, path]);

  useEffect(() => {
    if (!enabled || !path.trim()) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    void refetch();
  }, [enabled, path, refetch]);

  return {
    data,
    loading,
    error,
    refetch,
  };
}
