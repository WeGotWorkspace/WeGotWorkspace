import { DriveTransportError } from "@/lib/api/wgw/drive-jmap";
import {
  DriveServerFullError,
  DriveUploadForbiddenError,
  DriveUploadInsecureContextError,
  DriveUploadPermanentError,
  DriveUploadTargetMissingError,
  DriveUploadTooLargeError,
} from "@/lib/api/wgw/drive-upload-errors";
import { WgwSessionRenewalError } from "@/lib/api/wgw/session-renewal-error";
import { WgwSignInRequiredError } from "@/lib/api/wgw/sign-in-required-error";
import { JmapMethodError, JmapRequestError, JmapSetItemError } from "@/lib/jmap-client";
import { isFetchNetworkError } from "@/lib/offline/core/browser-online";
import { isQuotaExceededError } from "@/lib/offline/drive/upload/drive-upload-device-storage";
import type {
  DriveUploadErrorCode,
  DriveUploadItemError,
} from "@/lib/offline/drive/upload/drive-upload-schema";

/**
 * What the uploader does with a failed attempt:
 * - `fail`: the item stops with that reason (`keepProgress`: *Retry* resumes
 *   from the stored parts, for a full server);
 * - `transient`: back in the queue after a wait that grows per attempt, counted;
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

function fail(
  code: DriveUploadErrorCode,
  message: string,
  keepProgress = false,
): DriveUploadFailure {
  return { kind: "fail", error: { code, message }, keepProgress };
}

/** A 507 or `overQuota` anywhere (a part, an assembly step, the join, the create or update). */
function isServerFull(error: unknown): boolean {
  if (error instanceof DriveServerFullError) return true;
  if (httpStatusOf(error) === 507) return true;
  return error instanceof JmapSetItemError && error.setError.type === "overQuota";
}

/** A create into a folder that is gone answers `invalidProperties` on `parentId`. */
function isMissingParent(error: unknown): boolean {
  if (!(error instanceof JmapSetItemError) || error.setError.type !== "invalidProperties") {
    return false;
  }
  const properties = error.setError.properties;
  return Array.isArray(properties) && properties.includes("parentId");
}

function isForbidden(error: unknown): boolean {
  if (error instanceof DriveUploadForbiddenError) return true;
  if (httpStatusOf(error) === 403) return true;
  return error instanceof JmapSetItemError && error.setError.type === "forbidden";
}

/**
 * The error class of one failed attempt (#1520). Order matters: a reason of
 * its own (`insecure_context`, `too_large`, a full server, access) wins over
 * the generic HTTP buckets. `insecure_context` is never turned into
 * `transient` or `too_large`.
 */
export function classifyDriveUploadFailure(error: unknown): DriveUploadFailure {
  if (error instanceof DriveUploadInsecureContextError) {
    return fail("insecure_context", error.message);
  }
  // Only after the part size reached its floor (#1519); a bare 413 on a JMAP
  // call is not about the file's size.
  if (error instanceof DriveUploadTooLargeError) return fail("too_large", error.message);
  if (isServerFull(error)) {
    return fail("server_full", "The server has no space left for this file.", true);
  }
  if (isQuotaExceededError(error)) {
    return fail("quota", "This device has no room left for this file.");
  }
  if (error instanceof WgwSignInRequiredError || httpStatusOf(error) === 401) {
    return fail("auth", "Sign in again to continue uploading.");
  }
  if (isForbidden(error)) return fail("forbidden", "You can no longer add files to this folder.");
  if (error instanceof DriveUploadTargetMissingError || isMissingParent(error)) {
    return fail("target_missing", "The folder this file was going to no longer exists.");
  }
  if (error instanceof DriveUploadPermanentError) return fail("permanent", error.message);
  if (error instanceof DOMException && error.name === "AbortError") return { kind: "network" };
  if (isFetchNetworkError(error)) return { kind: "network" };
  if (isTransient(error)) return { kind: "transient", message: messageOf(error) };
  return fail("permanent", messageOf(error));
}

function isTransient(error: unknown): boolean {
  if (error instanceof WgwSessionRenewalError) return true;
  // Another call holds the assembly's lease, or the server hiccuped.
  if (error instanceof JmapMethodError) {
    return error.errorType === "serverUnavailable" || error.errorType === "serverFail";
  }
  if (error instanceof JmapSetItemError) return error.setError.type === "serverFail";
  const status = httpStatusOf(error);
  return status === 408 || status === 429 || (typeof status === "number" && status >= 500);
}
