import { describe, expect, it } from "vitest";
import {
  contactDisplayName,
  contactPersonName,
  findBirthAnniversary,
  firstOrganizationName,
  isContactAnniversary,
  mapEntriesSorted,
  synthesizeNameFromComponents,
} from "@/lib/models/contacts-display";
import type { ContactCard } from "@/lib/models/contacts-types";

const card = (over: Record<string, unknown>) => over as unknown as ContactCard;

describe("contacts-display", () => {
  it("mapEntriesSorted sorts by key and tolerates undefined", () => {
    expect(mapEntriesSorted(undefined)).toEqual([]);
    expect(mapEntriesSorted({ b: 1, a: 2 })).toEqual([
      ["a", 2],
      ["b", 1],
    ]);
  });

  it("synthesizeNameFromComponents puts given before surname, then falls back to any value", () => {
    expect(synthesizeNameFromComponents(undefined)).toBe("");
    expect(
      synthesizeNameFromComponents([
        { kind: "surname", value: " Lovelace " },
        { kind: "given", value: "Ada" },
        { kind: "given2", value: "M" },
      ]),
    ).toBe("Ada M Lovelace");
    expect(
      synthesizeNameFromComponents([
        { kind: "title", value: "Dr" },
        { kind: "credential", value: " " },
      ]),
    ).toBe("Dr");
  });

  it("contactPersonName prefers name.full", () => {
    expect(contactPersonName(card({ name: { full: " Ada L " } }))).toBe("Ada L");
    expect(
      contactPersonName(card({ name: { components: [{ kind: "given", value: "Ada" }] } })),
    ).toBe("Ada");
  });

  it("contactDisplayName follows the contact kind", () => {
    const org = { organizations: { o: { name: "Acme" } } };
    const person = { name: { full: "Ada" } };
    expect(contactDisplayName(card({ kind: "org", ...org, ...person }))).toBe("Acme");
    expect(contactDisplayName(card({ kind: "org", ...person }))).toBe("Ada");
    expect(contactDisplayName(card({ kind: "org" }))).toBe("Unknown contact");
    expect(contactDisplayName(card({ kind: "group", ...org, ...person }))).toBe("Ada");
    expect(contactDisplayName(card({ kind: "group", ...org }))).toBe("Acme");
    expect(contactDisplayName(card({ kind: "group" }))).toBe("Unknown contact");
    expect(contactDisplayName(card({ kind: "individual", ...org, ...person }))).toBe("Ada");
    expect(contactDisplayName(card({ kind: "individual", ...org }))).toBe("Acme");
    expect(contactDisplayName(card({}))).toBe("Unknown contact");
  });

  it("firstOrganizationName falls back to the first unit", () => {
    expect(firstOrganizationName(card({ organizations: { o: { name: " Acme " } } }))).toBe("Acme");
    expect(
      firstOrganizationName(card({ organizations: { o: { units: [{ name: " Lab " }] } } })),
    ).toBe("Lab");
    expect(firstOrganizationName(card({ organizations: { o: {} } }))).toBeUndefined();
    expect(firstOrganizationName(card({}))).toBeUndefined();
  });

  it("findBirthAnniversary skips cleared and non-birth slots", () => {
    expect(isContactAnniversary(null)).toBe(false);
    expect(isContactAnniversary({ kind: "birth" } as never)).toBe(true);
    const found = findBirthAnniversary(
      card({ anniversaries: { a: null, b: { kind: "death" }, c: { kind: "birth" } } }),
    );
    expect(found?.[0]).toBe("c");
    expect(findBirthAnniversary(card({}))).toBeUndefined();
  });
});

describe("splitFullName", () => {
  it("splits on the last space and keeps single names as given", async () => {
    const { splitFullName } = await import("@/lib/models/contacts-name-patch");
    expect(splitFullName("Ada King Lovelace")).toEqual({ given: "Ada King", surname: "Lovelace" });
    expect(splitFullName(" Madonna ")).toEqual({ given: "Madonna", surname: "" });
  });
});
