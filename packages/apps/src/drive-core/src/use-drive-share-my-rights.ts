import { useMemo } from "react";
import type { DriveRights } from "@wgw-api-generated/drive-types";
import type { DriveShareOperations } from "@/drive-core/src/drive-types";
import { useShareAtPath } from "@/share-ui/use-share-at-path";

export type UseDriveShareMyRightsArgs = {
  path: string;
  operations?: DriveShareOperations;
  enabled?: boolean;
};

export type UseDriveShareMyRightsResult = {
  /** `null` while loading or when fetch is disabled / failed. */
  myRights: DriveRights | null;
  /** `undefined` while loading (hide Share until known); then boolean. */
  mayShare: boolean | undefined;
  loading: boolean;
};

/** Resolves `myRights` from shares at-path for the active file. */
export function useDriveShareMyRights({
  path,
  operations,
  enabled = true,
}: UseDriveShareMyRightsArgs): UseDriveShareMyRightsResult {
  const canFetch = enabled && Boolean(operations && path.trim());

  const { data, loading } = useShareAtPath({
    path,
    operations: operations!,
    enabled: canFetch,
  });

  const myRights = useMemo(() => {
    if (!canFetch) return null;
    if (!data) return null;
    return data.myRights;
  }, [canFetch, data]);

  const mayShare = useMemo(() => {
    if (!canFetch) return undefined;
    if (!data && loading) return undefined;
    if (!data) return false;
    return data.myRights.mayShare;
  }, [canFetch, data, loading]);

  return { myRights, mayShare, loading: canFetch && loading };
}
