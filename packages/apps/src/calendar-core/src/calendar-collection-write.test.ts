import { describe, expect, it } from "vitest";
import {
  canWriteCalendarCollection,
  isCalendarCollectionOwner,
  isCalendarEventFormReadOnly,
} from "@/calendar-core/src/calendar-collection-write";

describe("isCalendarCollectionOwner", () => {
  it("treats undefined mayShare on a personal calendar as owner", () => {
    expect(isCalendarCollectionOwner({ mayWrite: true })).toBe(true);
    expect(isCalendarCollectionOwner({ scope: "personal", mayWrite: true })).toBe(true);
  });

  it("treats mayShare true as owner and mayShare false as sharee", () => {
    expect(isCalendarCollectionOwner({ mayShare: true, mayWrite: true })).toBe(true);
    expect(isCalendarCollectionOwner({ mayShare: false, mayWrite: true })).toBe(false);
  });

  it("treats group calendars as non-owners even when mayShare is omitted", () => {
    expect(isCalendarCollectionOwner({ scope: "group", mayWrite: true })).toBe(false);
    expect(isCalendarCollectionOwner({ scope: "group", mayShare: false, mayWrite: true })).toBe(
      false,
    );
  });
});

describe("canWriteCalendarCollection", () => {
  it("is writable unless mayWrite is false", () => {
    expect(canWriteCalendarCollection(undefined)).toBe(true);
    expect(canWriteCalendarCollection({ mayWrite: true })).toBe(true);
    expect(canWriteCalendarCollection({ mayWrite: false })).toBe(false);
  });
});

describe("isCalendarEventFormReadOnly", () => {
  it("never locks create mode", () => {
    expect(
      isCalendarEventFormReadOnly({
        mode: "create",
        calendar: { mayShare: false, mayWrite: false },
        isOrganizer: false,
      }),
    ).toBe(false);
  });

  it("keeps the invitee RSVP lock when mayShare is undefined on a personal calendar", () => {
    expect(
      isCalendarEventFormReadOnly({
        mode: "edit",
        calendar: { mayWrite: true },
        isOrganizer: false,
      }),
    ).toBe(true);
    expect(
      isCalendarEventFormReadOnly({
        mode: "edit",
        calendar: { mayShare: true, mayWrite: true },
        isOrganizer: false,
      }),
    ).toBe(true);
    expect(
      isCalendarEventFormReadOnly({
        mode: "edit",
        calendar: { mayWrite: true },
        isOrganizer: true,
      }),
    ).toBe(false);
  });

  it("lets group members and write-share recipients edit when they are not organizer", () => {
    expect(
      isCalendarEventFormReadOnly({
        mode: "edit",
        calendar: { scope: "group", mayShare: false, mayWrite: true },
        isOrganizer: false,
      }),
    ).toBe(false);
    expect(
      isCalendarEventFormReadOnly({
        mode: "edit",
        calendar: { mayShare: false, mayWrite: true },
        isOrganizer: false,
      }),
    ).toBe(false);
  });

  it("locks read-share collections", () => {
    expect(
      isCalendarEventFormReadOnly({
        mode: "edit",
        calendar: { mayShare: false, mayWrite: false },
        isOrganizer: false,
      }),
    ).toBe(true);
  });
});
