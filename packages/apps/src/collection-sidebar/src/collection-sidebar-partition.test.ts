import { describe, expect, it } from "vitest";
import {
  isSharedWithMeCollection,
  partitionOwnedAndShared,
} from "@/collection-sidebar/src/collection-sidebar-partition";

describe("collection sidebar partition", () => {
  it("treats Shared with me as isSharee, not mayShare === false", () => {
    expect(isSharedWithMeCollection({ name: "Inbox", isSharee: true })).toBe(true);
    expect(isSharedWithMeCollection({ name: "Inbox", isSharee: false, mayShare: false })).toBe(
      false,
    );
    expect(isSharedWithMeCollection({ name: "Owned", mayShare: false })).toBe(false);
  });

  it("accepts an isSharee predicate and an optional subscription predicate", () => {
    const subscription = { name: "Holidays", isSharee: true, subscriptionId: "sub-1" };
    expect(
      isSharedWithMeCollection(subscription, {
        isSharee: (item) => item.isSharee,
        isSubscription: (item) => Boolean(item.subscriptionId),
      }),
    ).toBe(false);
    expect(
      isSharedWithMeCollection(subscription, {
        isSharee: (item) => item.isSharee,
      }),
    ).toBe(true);
  });

  it("sorts owned and shared A–Z and does not require subscriptionId", () => {
    const items = [
      { name: "Zebra", isSharee: false },
      { name: "Family", isSharee: true },
      { name: "Alpha", isSharee: false },
      { name: "Beta", isSharee: true },
    ];
    expect(partitionOwnedAndShared(items)).toEqual({
      owned: [
        { name: "Alpha", isSharee: false },
        { name: "Zebra", isSharee: false },
      ],
      shared: [
        { name: "Beta", isSharee: true },
        { name: "Family", isSharee: true },
      ],
    });
  });
});
