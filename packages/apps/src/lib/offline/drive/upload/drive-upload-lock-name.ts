import { offlineAccountKeyFromUsername } from "@/lib/offline/core/offline-db";

/**
 * Cross-tab lock name of the Drive uploader for one account. It must differ
 * from the token refresh lock (`AUTH_REFRESH_LOCK_NAME`): the uploader holds
 * this lock while it calls `wgwFetch`, which may take the refresh lock.
 */
export function driveUploaderLockName(username: string): string {
  return `wgw-drive-uploader:${offlineAccountKeyFromUsername(username)}`;
}
