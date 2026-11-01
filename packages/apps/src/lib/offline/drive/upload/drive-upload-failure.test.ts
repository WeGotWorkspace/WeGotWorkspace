import { describe, expect, it } from "vitest";
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
import { classifyDriveUploadFailure } from "@/lib/offline/drive/upload/drive-upload-failure";
import { driveUploadRetryDelay } from "@/lib/offline/drive/upload/drive-upload-runner";

function codeOf(error: unknown) {
  const failure = classifyDriveUploadFailure(error);
  return failure.kind === "fail" ? failure.error.code : failure.kind;
}

describe("drive upload error classes", () => {
  it("too_large only once the part size reached its floor, never for a bare 413", () => {
    expect(codeOf(new DriveUploadTooLargeError("big.bin", 256 * 1024))).toBe("too_large");
    expect(codeOf(new JmapRequestError("JMAP request failed (413)", { status: 413 }))).toBe(
      "permanent",
    );
  });

  it("quota for a device that refuses to store bytes", () => {
    expect(codeOf(new DOMException("full", "QuotaExceededError"))).toBe("quota");
  });

  it("server_full for a 507 and overQuota, keeping the parts, never as a hiccup", () => {
    for (const error of [
      new DriveServerFullError(),
      new DriveTransportError("POST /jmap/upload failed (507)", 507),
      new JmapRequestError("JMAP request failed (507)", { status: 507 }),
      new JmapSetItemError("create", "upload", { type: "overQuota" }),
    ]) {
      expect(classifyDriveUploadFailure(error)).toMatchObject({
        kind: "fail",
        error: { code: "server_full" },
        keepProgress: true,
      });
    }
  });

  it("auth for a 401 and for a session that is gone, and only then", () => {
    expect(codeOf(new DriveTransportError("POST /jmap/upload failed (401)", 401))).toBe("auth");
    expect(codeOf(new JmapRequestError("JMAP request failed (401)", { status: 401 }))).toBe("auth");
    expect(codeOf(new WgwSignInRequiredError())).toBe("auth");
  });

  it("forbidden for a 403 or a refused create: no sign-in, no backoff", () => {
    for (const error of [
      new DriveTransportError("POST /jmap/upload failed (403)", 403),
      new JmapRequestError("JMAP request failed (403)", { status: 403 }),
      new JmapSetItemError("create", "upload", { type: "forbidden" }),
      new DriveUploadForbiddenError("fn-docs"),
    ]) {
      expect(codeOf(error)).toBe("forbidden");
    }
  });

  it("target_missing for a folder that is gone or in the trash", () => {
    expect(codeOf(new DriveUploadTargetMissingError("fn-docs"))).toBe("target_missing");
    expect(
      codeOf(
        new JmapSetItemError("create", "upload", {
          type: "invalidProperties",
          properties: ["parentId"],
        }),
      ),
    ).toBe("target_missing");
    // Another invalid property is not about the folder.
    expect(
      codeOf(
        new JmapSetItemError("create", "upload", {
          type: "invalidProperties",
          properties: ["blobId"],
        }),
      ),
    ).toBe("permanent");
  });

  it("keeps insecure_context, never turning it into transient or too_large", () => {
    expect(classifyDriveUploadFailure(new DriveUploadInsecureContextError())).toMatchObject({
      kind: "fail",
      error: { code: "insecure_context" },
      keepProgress: false,
    });
  });

  it("transient for hiccups, which are retried with a growing wait", () => {
    for (const error of [
      new DriveTransportError("POST /jmap/upload failed (503)", 503),
      new JmapRequestError("JMAP request failed (429)", { status: 429 }),
      new JmapMethodError("BlobAssembly/append", "c1", { type: "serverUnavailable" }),
      new JmapSetItemError("create", "upload", { type: "serverFail" }),
      new WgwSessionRenewalError(),
    ]) {
      expect(classifyDriveUploadFailure(error).kind).toBe("transient");
    }
    expect(classifyDriveUploadFailure(new TypeError("Failed to fetch")).kind).toBe("network");
    expect([1, 2, 3, 4, 5, 9].map(driveUploadRetryDelay)).toEqual([
      30_000, 60_000, 120_000, 240_000, 480_000, 480_000,
    ]);
  });

  it("permanent for anything retrying will not fix", () => {
    expect(codeOf(new DriveUploadPermanentError("Blob/upload failed (tooLarge)"))).toBe(
      "permanent",
    );
    expect(codeOf(new Error("something odd"))).toBe("permanent");
  });
});
