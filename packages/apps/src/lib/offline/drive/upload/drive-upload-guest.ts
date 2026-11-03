import type { DriveAPIOperations, DriveUIData } from "@/drive-core/src/drive-types";
import { driveJmapSession } from "@/lib/api/wgw/drive-jmap";
import { JmapRequestError } from "@/lib/jmap-client/core/errors";
import { normalizeApiVirtualPath } from "@/lib/files/api-path";
import { readDirectoryEntriesFromCache } from "@/lib/offline/drive/drive-directory-offline-store";
import { driveUploadQueueOperations } from "@/lib/offline/drive/upload/drive-upload-operations";

/** The account id the server gives a share-link guest's upload Session (#1715). */
const GUEST_UPLOAD_ACCOUNT = /^guest-[0-9a-f]{32}$/;

/**
 * The guest's upload account, or null when this link does not allow uploads.
 * The server opens a guest JMAP Session only for a link that allows uploads
 * (403 otherwise), so this is the live answer, not a guess from cached state.
 * Only that 403 answers null; a network error, 5xx, or 429 is temporary and
 * rethrows so the caller can ask again.
 * The queue runs under this account, never under the share owner's username
 * that the guest Drive shell shows.
 */
export async function resolveGuestUploadAccount(): Promise<string | null> {
  try {
    const session = await driveJmapSession();
    return GUEST_UPLOAD_ACCOUNT.test(session.accountId) ? session.accountId : null;
  } catch (error) {
    if (error instanceof JmapRequestError && error.status === 403) return null;
    throw error;
  }
}

/**
 * The upload queue for a share-link guest: the signed-in queue under the
 * guest's own account, with the folder's placeholders read from that
 * account's queue rows (a guest has no offline copy of the Drive).
 */
export function guestUploadQueueOperations(
  account: string,
  user: DriveUIData["user"],
): Partial<DriveAPIOperations> {
  return {
    ...driveUploadQueueOperations(account),
    readCachedDirectory: async (at) => {
      const cwd = normalizeApiVirtualPath(at);
      const files = await readDirectoryEntriesFromCache(account, cwd);
      return files.length > 0 ? { user, cwd, directory: { location: cwd, files } } : null;
    },
  };
}
