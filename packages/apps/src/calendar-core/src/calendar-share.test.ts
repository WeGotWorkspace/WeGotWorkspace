import { describe, expect, it } from "vitest";
import type { JmapCalendar, JmapCalendarRights } from "@/lib/jmap-client";
import {
  calendarInfoFromJmap,
  calendarRightsAllowWrite,
  calendarShareGrantEntries,
  calendarSharePermissionFromRights,
  calendarSharePrincipalsFromDirectory,
  calendarShareRightsForPermission,
  displayNameForSharePrincipal,
  filterCalendarSharePrincipals,
  isSharedWithMeCalendar,
  mergeCalendarShareWith,
} from "@/calendar-core/src/calendar-share";

describe("calendar share helpers", () => {
  it("treats mayWrite and mayWriteAll as write, and omitted rights as writable", () => {
    expect(calendarRightsAllowWrite({ mayWrite: true })).toBe(true);
    expect(calendarRightsAllowWrite({ mayWriteAll: true })).toBe(true);
    expect(calendarRightsAllowWrite({ mayWrite: false })).toBe(false);
    expect(calendarRightsAllowWrite({ mayWriteAll: false, mayWrite: true })).toBe(false);
    expect(calendarRightsAllowWrite(undefined)).toBe(true);
  });

  it("maps view/edit onto CalendarRights and back", () => {
    expect(calendarShareRightsForPermission("view")).toMatchObject({
      mayWrite: false,
      mayWriteAll: false,
    });
    expect(calendarShareRightsForPermission("edit")).toMatchObject({
      mayWrite: true,
      mayWriteAll: true,
    });
    expect(calendarSharePermissionFromRights({ mayWrite: false })).toBe("view");
    expect(calendarSharePermissionFromRights({ mayWriteAll: true })).toBe("edit");
  });

  it("marks personal sharees and not group or owned collections", () => {
    expect(isSharedWithMeCalendar({ mayShare: false })).toBe(true);
    expect(isSharedWithMeCalendar({ mayShare: true })).toBe(false);
    expect(isSharedWithMeCalendar({ scope: "group", groupSlug: "eng", mayShare: false })).toBe(
      false,
    );
    expect(isSharedWithMeCalendar({ mayShare: undefined })).toBe(false);
  });

  it("merges shareWith add, change, and null revoke", () => {
    const current = {
      alice: { mayWrite: false },
      bob: { mayWrite: true },
    };
    expect(
      mergeCalendarShareWith(current, {
        alice: { mayWrite: true },
        bob: null,
        "groups/eng": { mayWrite: false },
      }),
    ).toEqual({
      alice: { mayWrite: true },
      "groups/eng": { mayWrite: false },
    });
    expect(mergeCalendarShareWith({ alice: { mayWrite: true } }, { alice: null })).toBeNull();
  });

  it("lists group grants before users", () => {
    const entries = calendarShareGrantEntries({
      carol: { mayWrite: false },
      "groups/studio": { mayWrite: true },
      alice: { mayWrite: true },
    });
    expect(entries.map((entry) => entry.id)).toEqual(["groups/studio", "alice", "carol"]);
    expect(entries[0]?.isGroup).toBe(true);
  });

  it("filters principals and skips existing grants", () => {
    const principals = calendarSharePrincipalsFromDirectory({
      invitees: [
        { username: "alice", email: "alice@example.test", name: "Alice" },
        { username: "me", email: "me@example.test", name: "Me" },
      ],
      groups: [{ slug: "editorial", displayName: "Editorial Team" }],
      excludeUsername: "me",
    });
    expect(principals.map((row) => row.id)).toEqual(["groups/editorial", "alice"]);
    expect(filterCalendarSharePrincipals("ali", principals)).toEqual([
      { id: "alice", displayName: "Alice", principalType: "user" },
    ]);
    expect(
      filterCalendarSharePrincipals("alice", principals, { excludeIds: new Set(["alice"]) }),
    ).toEqual([]);
    expect(filterCalendarSharePrincipals("a", principals)).toEqual([]);
  });

  it("falls back to the JMAP id when no display name is known", () => {
    expect(displayNameForSharePrincipal("alice")).toBe("alice");
    expect(displayNameForSharePrincipal("groups/editorial")).toBe("editorial");
    expect(
      displayNameForSharePrincipal("groups/editorial", [
        { id: "groups/editorial", displayName: "Editorial Team", principalType: "group" },
      ]),
    ).toBe("Editorial Team");
  });

  it("maps live JMAP myRights and shareWith onto CalendarInfo", () => {
    const ownerRights: JmapCalendarRights = {
      mayReadFreeBusy: true,
      mayReadItems: true,
      mayWriteAll: true,
      mayWriteOwn: true,
      mayUpdatePrivate: true,
      mayRSVP: true,
      mayShare: true,
      mayDelete: true,
    };
    const readRights: JmapCalendarRights = {
      mayReadFreeBusy: true,
      mayReadItems: true,
      mayWriteAll: false,
      mayWriteOwn: false,
      mayUpdatePrivate: false,
      mayRSVP: false,
      mayShare: false,
      mayDelete: false,
    };
    const calendar: JmapCalendar = {
      id: "default",
      name: "Personal",
      color: "#6366f1",
      isDefault: true,
      myRights: ownerRights,
      shareWith: { alice: readRights },
    };
    expect(calendarInfoFromJmap(calendar)).toMatchObject({
      id: "default",
      mayWrite: true,
      mayShare: true,
      shareWith: {
        alice: { mayWriteAll: false, mayShare: false, mayDelete: false },
      },
    });
    expect(
      calendarInfoFromJmap({
        ...calendar,
        subscriptionId: "sub-ics-1",
      }),
    ).toMatchObject({ subscriptionId: "sub-ics-1" });
    expect(
      calendarInfoFromJmap({
        id: "shared",
        name: "Family",
        myRights: readRights,
        shareWith: null,
      }),
    ).toMatchObject({
      mayWrite: false,
      mayShare: false,
      shareWith: null,
    });
  });
});
