import { downloadGuestFileWithTicket } from "@/lib/api/wgw/drive-download-ticket";
import { DriveTransportError } from "@/lib/api/wgw/drive-jmap";
import { wgwEnsureFreshAccessToken } from "@/lib/api/wgw/http";
import { shareLabels } from "@/share-ui/share-labels";

const SHARE_SESSION_EXPIRED = "Share session expired. Open the link again.";

/**
 * Downloads the shared file through a guest download ticket: the browser
 * fetches it natively, so a large file streams to disk and can resume.
 */
export async function downloadSharedDriveFile(
  apiPath: string,
  signal?: AbortSignal,
): Promise<void> {
  const token = await wgwEnsureFreshAccessToken();
  if (!token) {
    throw new Error(SHARE_SESSION_EXPIRED);
  }
  try {
    await downloadGuestFileWithTicket(apiPath, signal);
  } catch (cause) {
    if (!(cause instanceof DriveTransportError)) throw cause;
    if (cause.status === 401) throw new Error(SHARE_SESSION_EXPIRED);
    // Only a refusal means the link is dead; a rate limit or server error is worth a retry.
    throw new Error(
      cause.status === 403 || cause.status === 404
        ? shareLabels.publicLinkOpenError
        : shareLabels.publicLinkDownloadError,
    );
  }
}
