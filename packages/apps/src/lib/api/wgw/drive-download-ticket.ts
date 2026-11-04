import { normalizeApiVirtualPath, parentAndName } from "@/lib/files/api-path";
import {
  DriveTransportError,
  resolveDownloadableFileNode,
  resolveFileNodeId,
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
  return readDownloadTicket(res, "POST /jmap/download-tickets");
}

/**
 * Asks the server for a download ticket for one file by path
 * (`POST /files/download-tickets`, #1622). Used by guests, who have no FileNode id.
 */
export async function issueGuestDriveDownloadTicket(
  path: string,
  signal?: AbortSignal,
): Promise<DriveDownloadTicket> {
  const res = await wgwFetch("/files/download-tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ path: normalizeApiVirtualPath(path) }),
    signal,
  });
  return readDownloadTicket(res, "POST /files/download-tickets");
}

async function readDownloadTicket(res: Response, route: string): Promise<DriveDownloadTicket> {
  if (!res.ok) {
    throw new DriveTransportError(`${route} failed (${res.status})`, res.status);
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

/** `POST /jmap/folder-download-tickets/{accountId}` answer (#1621). */
export type DriveFolderDownloadTicket = DriveDownloadTicket & {
  /** `<folder name>.zip`. */
  name: string;
};

/** Asks the server for a ticket that streams one folder as a zip. */
export async function issueFolderDownloadTicket(
  session: DriveJmapSession,
  nodeId: string,
  signal?: AbortSignal,
): Promise<DriveFolderDownloadTicket> {
  const res = await wgwFetch(
    `/jmap/folder-download-tickets/${encodeURIComponent(session.accountId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ nodeId }),
      signal,
    },
  );
  if (!res.ok) {
    throw new DriveTransportError(
      `POST /jmap/folder-download-tickets failed (${res.status})`,
      res.status,
    );
  }
  const ticket = (await res.json()) as Partial<DriveFolderDownloadTicket>;
  if (!ticket.url) throw new Error("The download ticket has no URL.");
  return {
    url: ticket.url,
    name: ticket.name || "download.zip",
    idleExpires: ticket.idleExpires ?? "",
    absoluteExpires: ticket.absoluteExpires ?? "",
  };
}

/**
 * *Download* on a folder (#1621): the server writes the zip while the
 * browser saves it natively; the client never builds the zip or a `Blob`.
 */
export async function downloadFolderAsZipWithTicket(
  session: DriveJmapSession,
  path: string,
  username: string,
  signal?: AbortSignal,
): Promise<void> {
  const nodeId = await resolveFileNodeId(session, path, username, signal);
  const ticket = await issueFolderDownloadTicket(session, nodeId, signal);
  startNativeDownload(ticket.url, ticket.name);
}

/**
 * The guest download: a ticket for the file in the share, downloaded by the
 * browser natively, so a large file streams to disk and can resume.
 */
export async function downloadGuestFileWithTicket(
  path: string,
  signal?: AbortSignal,
): Promise<void> {
  const name = parentAndName(path).from || "download";
  const ticket = await issueGuestDriveDownloadTicket(path, signal);
  startNativeDownload(ticket.url, name);
}
