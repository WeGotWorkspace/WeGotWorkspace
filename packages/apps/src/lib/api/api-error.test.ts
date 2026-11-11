import { describe, expect, it } from "vitest";
import { ApiError, isApiError } from "@/lib/api/api-error";
import { CalendarImportError } from "@/lib/api/wgw/calendar";
import { ContactsRequestError } from "@/lib/api/wgw/contacts";
import { DriveTransportError } from "@/lib/api/wgw/drive-jmap";
import { ShareSessionError } from "@/lib/api/wgw/drive-share-sessions";
import { MeetChatRequestError } from "@/lib/api/wgw/meet-chat";
import { NotesRequestError } from "@/lib/api/wgw/notes";
import { NotesVjournalRequestError } from "@/lib/api/wgw/notes-vjournal";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import { TasksRequestError } from "@/lib/api/wgw/tasks";
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

  it("keeps CollabHttpError.retryAfterMs", () => {
    expect(new CollabHttpError("m", 429, 2000).retryAfterMs).toBe(2000);
    expect(new CollabHttpError("m", 500).retryAfterMs).toBeNull();
  });
});
