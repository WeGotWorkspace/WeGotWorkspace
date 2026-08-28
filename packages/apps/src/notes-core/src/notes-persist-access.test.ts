import { describe, expect, it } from "vitest";
import {
  isNotesPersistForbidden,
  NOTES_ACCESS_LOST_MESSAGE,
  resolveNotesPersistAccess,
} from "@/notes-core/src/notes-persist-access";

describe("notes persist 403", () => {
  it("treats status 403 as access lost", () => {
    expect(isNotesPersistForbidden({ status: 403 })).toBe(true);
    expect(resolveNotesPersistAccess({ status: 403 })).toBe("leave-room");
  });

  it("treats a (403) message as access lost", () => {
    expect(isNotesPersistForbidden(new Error("PATCH /notes/items/uid failed (403)"))).toBe(true);
  });

  it("does not leave the room for 412 or network errors", () => {
    expect(resolveNotesPersistAccess({ status: 412 })).toBe("continue");
    expect(resolveNotesPersistAccess(new Error("network down"))).toBe("continue");
  });

  it("exposes a visible not-saved message", () => {
    expect(NOTES_ACCESS_LOST_MESSAGE).toMatch(/no longer have access/i);
    expect(NOTES_ACCESS_LOST_MESSAGE).toMatch(/not stored/i);
  });
});
