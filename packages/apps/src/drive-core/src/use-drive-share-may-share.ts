import { useMemo } from "react";
import type { DriveShareOperations } from "@/drive-core/src/drive-types";
import { useShareAtPath } from "@/share-ui/use-share-at-path";

export type UseDriveShareMayShareArgs = {
  path: string;
  operations?: DriveShareOperations;
  enabled?: boolean;
};

/** Resolves `mayShare` from at-path; returns `undefined` while loading (hide Share until known). */
export function useDriveShareMayShare({
  path,
  operations,
  enabled = true,
}: UseDriveShareMayShareArgs) {
  const canFetch = enabled && Boolean(operations && path.trim());

  const { data, loading } = useShareAtPath({
    path,
    operations: operations!,
    enabled: canFetch,
  });

  const mayShare = useMemo(() => {
    if (!canFetch) return undefined;
    if (!data && loading) return undefined;
    if (!data) return false;
    return data.myRights.mayShare;
  }, [canFetch, data, loading]);

  return { mayShare, loading };
}
