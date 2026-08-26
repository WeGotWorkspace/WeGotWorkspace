import { describe, expect, it } from "vitest";
import {
  canChangeCalendarOwner,
  canManageCalendarSharing,
  canOpenCalendarSettings,
  canRenameCalendar,
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
    expect(isCalendarCollectionOwner({ scope: "group", mayShare: true, mayWrite: true })).toBe(
      false,
    );
  });
});

describe("canManageCalendarSharing", () => {
  it("allows personal owners and group members with mayShare", () => {
    expect(canManageCalendarSharing({ mayWrite: true })).toBe(true);
    expect(canManageCalendarSharing({ mayShare: true, mayWrite: true })).toBe(true);
    expect(canManageCalendarSharing({ scope: "group", mayShare: true, mayWrite: true })).toBe(true);
    expect(canManageCalendarSharing({ mayShare: false, mayWrite: true })).toBe(false);
    expect(canManageCalendarSharing({ scope: "group", mayWrite: true })).toBe(false);
  });
});

describe("calendar settings rights", () => {
  it("lets ACL sharees open edit and rename their instance", () => {
    const sharee = { mayShare: false as const, mayWrite: false };
    expect(canOpenCalendarSettings(sharee)).toBe(true);
    expect(canRenameCalendar(sharee)).toBe(true);
    expect(canRenameCalendar({ mayShare: true, mayWrite: true })).toBe(true);
    expect(canRenameCalendar({ subscriptionId: "sub-1", mayWrite: false })).toBe(true);
  });
});

describe("canChangeCalendarOwner", () => {
  it("allows personal owners and user-created group calendars", () => {
    expect(canChangeCalendarOwner({ id: "roadmap", mayShare: true, mayWrite: true })).toBe(true);
    expect(
      canChangeCalendarOwner({
        id: "roadmap",
        scope: "group",
        groupSlug: "team",
        mayShare: true,
        mayWrite: true,
      }),
    ).toBe(true);
  });

  it("locks default, provisioned group, subscriptions, and sharees", () => {
    expect(
      canChangeCalendarOwner({ id: "default", isDefault: true, mayShare: true, mayWrite: true }),
    ).toBe(false);
    expect(
      canChangeCalendarOwner({
        id: "group-team",
        scope: "group",
        groupSlug: "team",
        mayShare: true,
        mayWrite: true,
      }),
    ).toBe(false);
    expect(
      canChangeCalendarOwner({
        id: "holidays",
        subscriptionId: "sub-1",
        mayShare: true,
        mayWrite: false,
      }),
    ).toBe(false);
    expect(canChangeCalendarOwner({ id: "family", mayShare: false, mayWrite: false })).toBe(false);
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
        calendar: { scope: "group", mayShare: true, mayWrite: true },
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
