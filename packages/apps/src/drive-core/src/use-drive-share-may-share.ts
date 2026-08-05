import { useDriveShareMyRights } from "@/drive-core/src/use-drive-share-my-rights";
import type { DriveShareOperations } from "@/drive-core/src/drive-types";

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
  const { mayShare, loading } = useDriveShareMyRights({ path, operations, enabled });
  return { mayShare, loading };
}
