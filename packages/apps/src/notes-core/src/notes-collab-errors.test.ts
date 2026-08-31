import { describe, expect, it } from "vitest";
import {
  isNotesPayloadTooLargeError,
  isNotesPreconditionFailedError,
  NOTES_TOO_LARGE_MESSAGE,
} from "@/notes-core/src/notes-collab-errors";

describe("notes collab persist errors", () => {
  it("detects 413 so saves stop retrying", () => {
    expect(
      isNotesPayloadTooLargeError(Object.assign(new Error("PATCH failed (413)"), { status: 413 })),
    ).toBe(true);
    expect(NOTES_TOO_LARGE_MESSAGE).toMatch(/too large/i);
  });

  it("detects 412 so initial join does not empty-seed", () => {
    expect(isNotesPreconditionFailedError(new Error("precondition failed (412)"))).toBe(true);
  });
});
