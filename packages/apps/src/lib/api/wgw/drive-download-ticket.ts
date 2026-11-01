import { parentAndName } from "@/lib/files/api-path";
import {
  DriveTransportError,
  resolveDownloadableFileNode,
  type DriveJmapSession,
} from "@/lib/api/wgw/drive-jmap";
import { wgwFetch } from "@/lib/api/wgw/http";

/** `POST /jmap/download-tickets/{accountId}` answer (#1500). */
export type DriveDownloadTicket = {
  /** Unauthenticated URL the browser can download natively (with Range resumes). */
  url: string;
  idleExpires: string;
  absoluteExpires: string;
};

/** Asks the server for a download ticket for one blob. */
export async function issueDriveDownloadTicket(
  session: DriveJmapSession,
  input: { blobId: string; name: string; type?: string | null },
  signal?: AbortSignal,
): Promise<DriveDownloadTicket> {
  const res = await wgwFetch(`/jmap/download-tickets/${encodeURIComponent(session.accountId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      blobId: input.blobId,
      name: input.name,
      ...(input.type ? { type: input.type } : {}),
    }),
    signal,
  });
  if (!res.ok) {
    throw new DriveTransportError(`POST /jmap/download-tickets failed (${res.status})`, res.status);
  }
  const ticket = (await res.json()) as Partial<DriveDownloadTicket>;
  if (!ticket.url) throw new Error("The download ticket has no URL.");
  return {
    url: ticket.url,
    idleExpires: ticket.idleExpires ?? "",
    absoluteExpires: ticket.absoluteExpires ?? "",
  };
}

/** Lets the browser download `url` itself: the bytes stream to disk, never into a `Blob`. */
export function startNativeDownload(url: string, filename: string): void {
  if (typeof document === "undefined") return;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * The signed-in Drive download: a ticket for the file's blob, downloaded by
 * the browser natively, so a 4 GB file streams to disk instead of memory.
 */
export async function downloadFileNodeWithTicket(
  session: DriveJmapSession,
  path: string,
  username: string,
  signal?: AbortSignal,
): Promise<void> {
  const node = await resolveDownloadableFileNode(session, path, username, signal);
  const name = node.name || parentAndName(path).from || "download";
  const ticket = await issueDriveDownloadTicket(
    session,
    { blobId: node.blobId, name, type: node.type },
    signal,
  );
  startNativeDownload(ticket.url, name);
}
