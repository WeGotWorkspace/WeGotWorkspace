import { describe, expect, it } from "vitest";
import {
  displayNameForSharePrincipal,
  filterSharePrincipals,
  mergeShareWith,
  shareGrantEntries,
  sharePermissionFromRights,
  sharePrincipalsFromDirectory,
  shareRightsAllowWrite,
  shareRightsForPermission,
} from "@/share-ui/collection-share";

describe("collection share helpers", () => {
  it("treats mayWrite and mayWriteAll as write, and omitted rights as writable", () => {
    expect(shareRightsAllowWrite({ mayWrite: true })).toBe(true);
    expect(shareRightsAllowWrite({ mayWriteAll: true })).toBe(true);
    expect(shareRightsAllowWrite({ mayWrite: false })).toBe(false);
    expect(shareRightsAllowWrite({ mayWriteAll: false, mayWrite: true })).toBe(false);
    expect(shareRightsAllowWrite(undefined)).toBe(true);
  });

  it("maps view/edit onto rights and back", () => {
    expect(shareRightsForPermission("view")).toMatchObject({
      mayWrite: false,
      mayWriteAll: false,
    });
    expect(shareRightsForPermission("edit")).toMatchObject({
      mayWrite: true,
      mayWriteAll: true,
    });
    expect(sharePermissionFromRights({ mayWrite: false })).toBe("view");
    expect(sharePermissionFromRights({ mayWriteAll: true })).toBe("edit");
  });

  it("merges shareWith add, change, and null revoke", () => {
    expect(
      mergeShareWith(
        { alice: { mayWrite: false }, bob: { mayWrite: true } },
        { alice: { mayWrite: true }, bob: null, "groups/eng": { mayWrite: false } },
      ),
    ).toEqual({
      alice: { mayWrite: true },
      "groups/eng": { mayWrite: false },
    });
    expect(mergeShareWith({ alice: { mayWrite: true } }, { alice: null })).toBeNull();
  });

  it("lists group grants before users", () => {
    const entries = shareGrantEntries({
      carol: { mayWrite: false },
      "groups/studio": { mayWrite: true },
      alice: { mayWrite: true },
    });
    expect(entries.map((entry) => entry.id)).toEqual(["groups/studio", "alice", "carol"]);
    expect(entries[0]?.isGroup).toBe(true);
  });

  it("filters principals and skips existing grants", () => {
    const principals = sharePrincipalsFromDirectory({
      users: [
        { id: "alice", displayName: "Alice" },
        { id: "me", displayName: "Me" },
      ],
      groups: [{ slug: "editorial", displayName: "Editorial Team" }],
      excludeId: "me",
    });
    expect(principals.map((row) => row.id)).toEqual(["groups/editorial", "alice"]);
    expect(filterSharePrincipals("ali", principals)).toEqual([
      { id: "alice", displayName: "Alice", principalType: "user" },
    ]);
    expect(filterSharePrincipals("alice", principals, { excludeIds: new Set(["alice"]) })).toEqual(
      [],
    );
    expect(filterSharePrincipals("a", principals)).toEqual([]);
  });

  it("falls back to the id when no display name is known", () => {
    expect(displayNameForSharePrincipal("alice")).toBe("alice");
    expect(displayNameForSharePrincipal("groups/editorial")).toBe("editorial");
    expect(
      displayNameForSharePrincipal("groups/editorial", [
        { id: "groups/editorial", displayName: "Editorial Team", principalType: "group" },
      ]),
    ).toBe("Editorial Team");
  });
});
