import { describe, expect, it } from "vitest";
import { mergeContactFromPatch } from "@/lib/models/contacts-patch-merge";
import type { ContactCard, ContactCardPatch } from "@/lib/models/contacts-types";

const card = {
  id: "c1",
  name: { full: "Ada" },
  phones: { p1: { number: "1" }, p2: { number: "2" } },
  anniversaries: { a1: { date: "2020-01-01" } },
} as unknown as ContactCard;

describe("mergeContactFromPatch", () => {
  it("overlays map entries and keeps the name when the patch has none", () => {
    const merged = mergeContactFromPatch(card, {
      phones: { p3: { number: "3" } },
    } as unknown as ContactCardPatch);
    expect(Object.keys(merged.phones ?? {})).toEqual(["p1", "p2", "p3"]);
    expect(merged.name).toEqual(card.name);
  });

  it("treats null map entries as delete and drops an emptied anniversaries map", () => {
    const merged = mergeContactFromPatch(card, {
      name: { full: "Grace" },
      phones: { p1: null },
      anniversaries: { a1: null },
    } as unknown as ContactCardPatch);
    expect(merged.phones).toEqual({ p2: { number: "2" } });
    expect(merged.anniversaries).toBeUndefined();
    expect(merged.name).toEqual({ full: "Grace" });
  });
});
