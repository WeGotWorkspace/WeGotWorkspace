import { describe, expect, it } from "vitest";
import { ApiError, isApiError, UnexpectedApiResponseError } from "@/lib/api/api-error";
import { WgwAppDisabledError } from "@/lib/api/wgw/app-disabled-error";
import { CalendarImportError } from "@/lib/api/wgw/calendar";
import { ContactsRequestError } from "@/lib/api/wgw/contacts";
import { ContactSetRejectedError } from "@/lib/api/wgw/contacts-set";
import { DriveTransportError } from "@/lib/api/wgw/drive-jmap";
import { ShareSessionError } from "@/lib/api/wgw/drive-share-sessions";
import { DriveUploadPartRejectedError } from "@/lib/api/wgw/drive-upload-errors";
import { WgwGuestSessionMissingError } from "@/lib/api/wgw/guest-session-missing-error";
import { MeetChatRequestError } from "@/lib/api/wgw/meet-chat";
import { NotesRequestError } from "@/lib/api/wgw/notes";
import { NotesVjournalRequestError } from "@/lib/api/wgw/notes-vjournal";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import { WgwSessionRenewalError } from "@/lib/api/wgw/session-renewal-error";
import { TasksRequestError } from "@/lib/api/wgw/tasks";
import { httpStatusFromFlushError } from "@/lib/offline/core/outbox-error-status";
import { HttpSignalingError } from "@/lib/rtc/signaling/http-client";
import { CollabHttpError } from "@/text-editor-core/docs-collab/docs-collab-utils";
import { DocsThreadsRequestError } from "@/text-editor-core/docs-collab/docs-threads-errors";

describe("ApiError", () => {
  it("carries the message, status and code", () => {
    const error = new ApiError("Not found.", 404, "not_found");

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Not found.");
    expect(error.status).toBe(404);
    expect(error.code).toBe("not_found");
  });

  it("sets no name of its own", () => {
    expect(new ApiError("x", 500).name).toBe("Error");
    expect(String(new ApiError("Boom", 500))).toBe("Error: Boom");
  });

  it("isApiError accepts only ApiError instances", () => {
    expect(isApiError(new ApiError("x", 400))).toBe(true);
    expect(isApiError(new WgwRequestError("x", 400))).toBe(true);
    expect(isApiError(new Error("x"))).toBe(false);
    expect(isApiError({ message: "x", status: 400 })).toBe(false);
    expect(isApiError(null)).toBe(false);
  });
});

// The name and message are what reach a log or a screen. Moving these classes
// onto ApiError must not change either (#1646).
describe.each([
  ["WgwRequestError", () => new WgwRequestError("m", 403), "Error"],
  ["NotesRequestError", () => new NotesRequestError("m", 403), "Error"],
  ["TasksRequestError", () => new TasksRequestError("m", 403, "c"), "Error"],
  ["ContactsRequestError", () => new ContactsRequestError("m", 403), "Error"],
  ["MeetChatRequestError", () => new MeetChatRequestError("m", 403, "c"), "Error"],
  ["NotesVjournalRequestError", () => new NotesVjournalRequestError("m", 403, "c"), "Error"],
  ["DocsThreadsRequestError", () => new DocsThreadsRequestError("m", 403, "c"), "Error"],
  ["DriveTransportError", () => new DriveTransportError("m", 403), "DriveTransportError"],
  ["ShareSessionError", () => new ShareSessionError("m", 403, "c"), "ShareSessionError"],
  ["CalendarImportError", () => new CalendarImportError("m", 403), "CalendarImportError"],
  ["CollabHttpError", () => new CollabHttpError("m", 403, 1500), "CollabHttpError"],
  ["HttpSignalingError", () => new HttpSignalingError("m", 403), "HttpSignalingError"],
] as const)("%s", (_label, make, expectedName) => {
  it("is an ApiError with an unchanged name, message and status", () => {
    const error = make();

    expect(isApiError(error)).toBe(true);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(expectedName);
    expect(error.message).toBe("m");
    expect(String(error)).toBe(`${expectedName}: m`);
    expect(error.status).toBe(403);
  });
});

describe("classes moved onto ApiError with their own message", () => {
  it("DriveUploadPartRejectedError keeps reason, status, name and message", () => {
    const error = new DriveUploadPartRejectedError("http_413", 413);

    expect(isApiError(error)).toBe(true);
    expect(error.reason).toBe("http_413");
    expect(error.status).toBe(413);
    expect(String(error)).toBe(
      "DriveUploadPartRejectedError: The server refused an upload part (http_413).",
    );
  });

  it("WgwSessionRenewalError keeps its fixed 503, name and message", () => {
    const error = new WgwSessionRenewalError();

    expect(isApiError(error)).toBe(true);
    expect(error.status).toBe(503);
    expect(String(error)).toBe(
      "WgwSessionRenewalError: Could not renew your session right now. Try again in a moment.",
    );
  });
});

// Failures with no HTTP status that used to be a bare Error (#1646). They are
// typed now, but must read exactly as before and must not gain a status: the
// outbox would otherwise move them out of the transient bucket.
describe.each([
  ["UnexpectedApiResponseError", () => new UnexpectedApiResponseError("m")],
  ["WgwGuestSessionMissingError", () => new WgwGuestSessionMissingError("m")],
  ["WgwAppDisabledError", () => new WgwAppDisabledError("m")],
  ["ContactSetRejectedError", () => new ContactSetRejectedError("m", "forbidden")],
] as const)("%s", (_label, make) => {
  it("reads like the bare Error it replaced and carries no status", () => {
    const error = make();

    expect(error).toBeInstanceOf(Error);
    expect(isApiError(error)).toBe(false);
    expect(error.name).toBe("Error");
    expect(String(error)).toBe("Error: m");
    expect("status" in error).toBe(false);
    expect(httpStatusFromFlushError(error)).toBeUndefined();
  });
});

describe("subclass fields", () => {
  it("keeps the API code where the class had one", () => {
    expect(new TasksRequestError("m", 409, "cannotCalculateChanges").code).toBe(
      "cannotCalculateChanges",
    );
    expect(new NotesVjournalRequestError("m", 409, "conflict").code).toBe("conflict");
    expect(new MeetChatRequestError("m", 400, "empty_text").code).toBe("empty_text");
    expect(new DocsThreadsRequestError("m", 410, "cannotCalculateChanges").code).toBe(
      "cannotCalculateChanges",
    );
    expect(new ShareSessionError("m", 401, "share_password_required").code).toBe(
      "share_password_required",
    );
  });

  it("keeps the JMAP SetError type on ContactSetRejectedError", () => {
    expect(new ContactSetRejectedError("m", "forbidden").setErrorType).toBe("forbidden");
    expect(new ContactSetRejectedError("Contact create failed", undefined).setErrorType).toBe(
      undefined,
    );
  });

  it("keeps CollabHttpError.retryAfterMs", () => {
    expect(new CollabHttpError("m", 429, 2000).retryAfterMs).toBe(2000);
    expect(new CollabHttpError("m", 500).retryAfterMs).toBeNull();
  });
});
