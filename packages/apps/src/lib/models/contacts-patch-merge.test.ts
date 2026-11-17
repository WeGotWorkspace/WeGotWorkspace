import { describe, expect, it } from "vitest";
import type { ContactCard, ContactCardPatch } from "@/lib/models/contacts-types";
import { mergeContactFromPatch } from "@/lib/models/contacts-patch-merge";

const active = {
  "@type": "Card",
  version: "1.0",
  id: "card-1",
  uid: "urn:uuid:1",
  addressBookIds: { default: true },
  phones: { p1: { "@type": "Phone", number: "+31 1" }, p2: { "@type": "Phone", number: "+31 2" } },
  anniversaries: {
    b1: {
      "@type": "Anniversary",
      kind: "birth",
      date: { "@type": "PartialDate", year: 1990, month: 5, day: 17 },
    },
  },
} as unknown as ContactCard;

describe("mergeContactFromPatch", () => {
  it("drops map entries the patch sets to null and keeps the rest", () => {
    const merged = mergeContactFromPatch(active, {
      phones: { p2: null },
    } as unknown as ContactCardPatch);
    expect(Object.keys(merged.phones ?? {})).toEqual(["p1"]);
    expect(merged.anniversaries?.b1).toEqual(active.anniversaries?.b1);
  });

  it("removes the anniversaries field when the patch deletes the last one", () => {
    const merged = mergeContactFromPatch(active, {
      anniversaries: { b1: null },
    } as unknown as ContactCardPatch);
    expect(merged).not.toHaveProperty("anniversaries");
    expect(Object.keys(merged.phones ?? {})).toEqual(["p1", "p2"]);
  });
});
