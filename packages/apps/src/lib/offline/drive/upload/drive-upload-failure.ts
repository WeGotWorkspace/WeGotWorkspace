import { DriveTransportError } from "@/lib/api/wgw/drive-jmap";
import {
  DriveServerFullError,
  DriveUploadInsecureContextError,
  DriveUploadPermanentError,
  DriveUploadTooLargeError,
} from "@/lib/api/wgw/drive-upload-errors";
import { WgwSessionRenewalError } from "@/lib/api/wgw/session-renewal-error";
import { JmapMethodError, JmapRequestError, JmapSetItemError } from "@/lib/jmap-client";
import { isFetchNetworkError } from "@/lib/offline/core/browser-online";
import type { DriveUploadItemError } from "@/lib/offline/drive/upload/drive-upload-schema";

/**
 * What the uploader does with a failed attempt:
 * - `fail`: the item stops with that reason (`keepProgress`: *Retry* resumes
 *   from the stored parts, for a full server);
 * - `transient`: back in the queue after a wait, counted;
 * - `network`: back in the queue after a wait, not counted.
 */
export type DriveUploadFailure =
  | { kind: "fail"; error: DriveUploadItemError; keepProgress: boolean }
  | { kind: "transient"; message: string }
  | { kind: "network" };

function httpStatusOf(error: unknown): number | undefined {
  if (error instanceof DriveTransportError) return error.status;
  if (error instanceof JmapRequestError) return error.status;
  return undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A 507 or `overQuota` anywhere (a part, an assembly step, the join, the
 * create or update). Never retried with backoff: until #1520 adds the
 * queue-wide pause, the item waits for *Retry*.
 */
function isServerFull(error: unknown): boolean {
  if (error instanceof DriveServerFullError) return true;
  if (httpStatusOf(error) === 507) return true;
  return error instanceof JmapSetItemError && error.setError.type === "overQuota";
}

export function classifyDriveUploadFailure(error: unknown): DriveUploadFailure {
  if (error instanceof DriveUploadInsecureContextError) {
    return {
      kind: "fail",
      error: { code: "insecure_context", message: error.message },
      keepProgress: false,
    };
  }
  if (error instanceof DriveUploadTooLargeError || httpStatusOf(error) === 413) {
    const message =
      error instanceof Error ? error.message : "The file is too large for this server.";
    return { kind: "fail", error: { code: "too_large", message }, keepProgress: false };
  }
  if (isServerFull(error)) {
    return {
      kind: "fail",
      error: { code: "server_full", message: "The server has no space left for this file." },
      keepProgress: true,
    };
  }
  if (error instanceof DriveUploadPermanentError) {
    return {
      kind: "fail",
      error: { code: "upload_failed", message: error.message },
      keepProgress: false,
    };
  }
  if (error instanceof DOMException && error.name === "AbortError") return { kind: "network" };
  if (isFetchNetworkError(error)) return { kind: "network" };
  if (isTransient(error)) return { kind: "transient", message: messageOf(error) };
  return {
    kind: "fail",
    error: { code: "upload_failed", message: messageOf(error) },
    keepProgress: false,
  };
}

function isTransient(error: unknown): boolean {
  if (error instanceof WgwSessionRenewalError) return true;
  // Another call holds the assembly's lease, or the server hiccuped.
  if (error instanceof JmapMethodError) {
    return error.errorType === "serverUnavailable" || error.errorType === "serverFail";
  }
  const status = httpStatusOf(error);
  return status === 408 || status === 429 || (typeof status === "number" && status >= 500);
}
