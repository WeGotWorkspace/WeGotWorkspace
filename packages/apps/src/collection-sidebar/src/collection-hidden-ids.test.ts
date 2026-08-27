import { describe, expect, it } from "vitest";
import { resolveHiddenCollectionIds } from "@/collection-sidebar/src/collection-hidden-ids";

describe("resolveHiddenCollectionIds", () => {
  const items = [{ id: "default" }, { id: "work" }, { id: "holidays", isVisible: false }];

  it("uses server visibility when nothing is persisted", () => {
    expect(resolveHiddenCollectionIds(items, undefined)).toEqual(["holidays"]);
    expect(resolveHiddenCollectionIds(items, {})).toEqual(["holidays"]);
  });

  it("keeps persisted hides that still exist and drops unknown ids", () => {
    expect(
      resolveHiddenCollectionIds(items, {
        hiddenIds: ["work", "gone"],
        knownIds: ["default", "work", "holidays"],
      }),
    ).toEqual(["work"]);
  });

  it("does not re-hide a server-default-hidden collection the user already showed", () => {
    expect(
      resolveHiddenCollectionIds(items, {
        hiddenIds: [],
        knownIds: ["default", "work", "holidays"],
      }),
    ).toEqual([]);
  });

  it("hides a new server-default-hidden collection the device has never seen", () => {
    expect(
      resolveHiddenCollectionIds(items, {
        hiddenIds: ["work"],
        knownIds: ["default", "work"],
      }),
    ).toEqual(["work", "holidays"]);
  });
});
