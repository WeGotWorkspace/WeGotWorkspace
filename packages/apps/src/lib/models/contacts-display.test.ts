import { describe, expect, it } from "vitest";
import type { ContactCard } from "@/lib/models/contacts-types";
import { contactDisplayName, synthesizeNameFromComponents } from "@/lib/models/contacts-display";

function cardWith(fields: Record<string, unknown>): ContactCard {
  return {
    "@type": "Card",
    version: "1.0",
    id: "card-1",
    uid: "urn:uuid:1",
    addressBookIds: { default: true },
    ...fields,
  } as unknown as ContactCard;
}

const personName = { "@type": "Name", isOrdered: false, full: "Jane Doe" };
const acme = { o1: { "@type": "Organization", name: "Acme" } };

describe("synthesizeNameFromComponents", () => {
  it("puts given names before surnames", () => {
    expect(
      synthesizeNameFromComponents([
        { kind: "surname", value: "Doe" },
        { kind: "given", value: "Jane" },
        { kind: "given2", value: "Q" },
      ]),
    ).toBe("Jane Q Doe");
  });

  it("joins the other parts when there is no given name or surname", () => {
    expect(
      synthesizeNameFromComponents([
        { kind: "title", value: " Dr. " },
        { kind: "separator", value: " " },
        { kind: "credential", value: "PhD" },
      ]),
    ).toBe("Dr. PhD");
  });

  it("is empty without components", () => {
    expect(synthesizeNameFromComponents(undefined)).toBe("");
    expect(synthesizeNameFromComponents([])).toBe("");
  });
});

describe("contactDisplayName", () => {
  it("shows an organization by its organization name, then the person, then Unknown", () => {
    expect(
      contactDisplayName(cardWith({ kind: "org", name: personName, organizations: acme })),
    ).toBe("Acme");
    expect(contactDisplayName(cardWith({ kind: "org", name: personName }))).toBe("Jane Doe");
    expect(contactDisplayName(cardWith({ kind: "org" }))).toBe("Unknown contact");
  });

  it("shows a group by its name, then the organization, then Unknown", () => {
    expect(
      contactDisplayName(cardWith({ kind: "group", name: personName, organizations: acme })),
    ).toBe("Jane Doe");
    expect(contactDisplayName(cardWith({ kind: "group", organizations: acme }))).toBe("Acme");
    expect(contactDisplayName(cardWith({ kind: "group" }))).toBe("Unknown contact");
  });

  it("shows a person by name, then the organization's first unit, then Unknown", () => {
    expect(contactDisplayName(cardWith({ kind: "individual", name: personName }))).toBe("Jane Doe");
    expect(
      contactDisplayName(
        cardWith({
          organizations: { o1: { "@type": "Organization", units: [{ name: "Sales" }] } },
        }),
      ),
    ).toBe("Sales");
    expect(contactDisplayName(cardWith({}))).toBe("Unknown contact");
  });
});
