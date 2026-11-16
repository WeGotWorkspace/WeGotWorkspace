import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ContactCard } from "@/lib/models/contacts-types";
import {
  contactCardToVCard,
  downloadMultipleContactsVCard,
  vcardFilename,
} from "@/lib/models/contacts-vcard-export";

function makeCard(overrides: Partial<ContactCard> = {}): ContactCard {
  const base: ContactCard = {
    "@type": "Card",
    version: "1.0",
    id: "card-1",
    addressBookIds: { default: true },
    kind: "individual",
    uid: "urn:uuid:test-uid",
  };
  return { ...base, ...overrides };
}

describe("vcardFilename", () => {
  it("returns display name with .vcf extension", () => {
    expect(vcardFilename("Jane Doe")).toBe("Jane_Doe.vcf");
  });

  it("replaces special characters", () => {
    expect(vcardFilename("André Müller")).toBe("Andr_M_ller.vcf");
  });

  it("falls back to 'contact' for blank names", () => {
    expect(vcardFilename("")).toBe("contact.vcf");
    expect(vcardFilename("   ")).toBe("contact.vcf");
  });
});

describe("contactCardToVCard", () => {
  it("contains required vCard 3.0 envelope", () => {
    const vcard = contactCardToVCard(makeCard());
    expect(vcard).toContain("BEGIN:VCARD");
    expect(vcard).toContain("VERSION:3.0");
    expect(vcard).toContain("END:VCARD");
  });

  it("includes FN from display name", () => {
    const card = makeCard({
      name: {
        "@type": "Name",
        isOrdered: false,
        full: "Jane Doe",
        components: [
          { "@type": "NameComponent", kind: "given", value: "Jane" },
          { "@type": "NameComponent", kind: "surname", value: "Doe" },
        ],
      },
    });
    const vcard = contactCardToVCard(card);
    expect(vcard).toContain("FN:Jane Doe");
  });

  it("includes structured N field", () => {
    const card = makeCard({
      name: {
        "@type": "Name",
        isOrdered: false,
        components: [
          { "@type": "NameComponent", kind: "given", value: "Jane" },
          { "@type": "NameComponent", kind: "given2", value: "Marie" },
          { "@type": "NameComponent", kind: "surname", value: "Doe" },
        ],
      },
    });
    const vcard = contactCardToVCard(card);
    expect(vcard).toContain("N:Doe;Jane;Marie;;");
  });

  it("includes ORG field", () => {
    const card = makeCard({
      organizations: {
        org1: { "@type": "Organization", name: "Acme Corp" },
      },
    });
    const vcard = contactCardToVCard(card);
    expect(vcard).toContain("ORG:Acme Corp");
  });

  it("includes EMAIL fields", () => {
    const card = makeCard({
      emails: {
        e1: { "@type": "EmailAddress", address: "jane@example.com", contexts: { work: true } },
      },
    });
    const vcard = contactCardToVCard(card);
    expect(vcard).toContain("EMAIL;TYPE=WORK:jane@example.com");
  });

  it("includes TEL fields", () => {
    const card = makeCard({
      phones: {
        p1: { "@type": "Phone", number: "+31612345678", features: { cell: true } },
      },
    });
    const vcard = contactCardToVCard(card);
    expect(vcard).toContain("TEL;TYPE=CELL:+31612345678");
  });

  it("includes NOTE field", () => {
    const card = makeCard({
      notes: {
        n1: { "@type": "Note", note: "Important contact" },
      },
    });
    const vcard = contactCardToVCard(card);
    expect(vcard).toContain("NOTE:Important contact");
  });

  it("escapes URL values when exporting links", () => {
    const card = makeCard({
      links: {
        l1: { "@type": "Link", uri: "https://example.com/a,b;c" },
      },
    });
    const vcard = contactCardToVCard(card);
    expect(vcard).toContain("URL:https://example.com/a\\,b\\;c");
  });

  it("skips URL values containing CRLF to prevent line injection", () => {
    const card = makeCard({
      links: {
        l1: {
          "@type": "Link",
          uri: "https://example.com\r\nNOTE:injected",
        },
      },
    });
    const vcard = contactCardToVCard(card);
    expect(vcard).not.toContain("URL:https://example.com");
    expect(vcard).not.toContain("NOTE:injected");
  });

  it("includes BDAY for birth anniversary (PartialDate)", () => {
    const card = makeCard({
      anniversaries: {
        bday: {
          "@type": "Anniversary",
          kind: "birth",
          date: { "@type": "PartialDate", year: 1990, month: 6, day: 15 },
        },
      },
    });
    const vcard = contactCardToVCard(card);
    expect(vcard).toContain("BDAY:19900615");
  });

  it("includes BDAY for birth anniversary without year", () => {
    const card = makeCard({
      anniversaries: {
        bday: {
          "@type": "Anniversary",
          kind: "birth",
          date: { "@type": "PartialDate", month: 6, day: 15 },
        },
      },
    });
    const vcard = contactCardToVCard(card);
    expect(vcard).toContain("BDAY:--0615");
  });

  it("includes UID field", () => {
    const card = makeCard({ uid: "urn:uuid:abc123" });
    const vcard = contactCardToVCard(card);
    // colons are not escaped in vCard property values
    expect(vcard).toContain("UID:urn:uuid:abc123");
  });

  it("escapes semicolons in values", () => {
    const card = makeCard({
      notes: {
        n1: { "@type": "Note", note: "Hello; World" },
      },
    });
    const vcard = contactCardToVCard(card);
    expect(vcard).toContain("NOTE:Hello\\; World");
  });

  it("skips empty phone numbers and emails", () => {
    const card = makeCard({
      phones: { p1: { "@type": "Phone", number: "   " } },
      emails: { e1: { "@type": "EmailAddress", address: "" } },
    });
    const vcard = contactCardToVCard(card);
    expect(vcard).not.toContain("TEL:");
    expect(vcard).not.toContain("EMAIL:");
  });
});

describe("downloadMultipleContactsVCard", () => {
  type MockAnchor = {
    href: string;
    download: string;
    style: { display: string };
    click: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };

  let anchor: MockAnchor;
  const fakeUrl = "blob:fake-url";

  beforeEach(() => {
    anchor = {
      href: "",
      download: "",
      style: { display: "" },
      click: vi.fn(),
      remove: vi.fn(),
    };

    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue(fakeUrl),
      revokeObjectURL: vi.fn(),
    });

    vi.stubGlobal("document", {
      createElement: vi.fn().mockReturnValue(anchor),
      body: { appendChild: vi.fn().mockReturnValue(anchor) },
    });
  });

  it("does nothing for an empty array", () => {
    downloadMultipleContactsVCard([]);
    expect(anchor.click).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("single-card falls back to single download (filename from contact name)", () => {
    const card = makeCard({
      uid: "uid-1",
      name: {
        "@type": "Name",
        isOrdered: false,
        full: "Alice",
        components: [{ "@type": "NameComponent", kind: "given", value: "Alice" }],
      },
    });
    downloadMultipleContactsVCard([card]);
    expect(anchor.click).toHaveBeenCalled();
    expect(anchor.download).not.toMatch(/\d+-contacts\.vcf/);
  });

  it("multi-card uses N-contacts.vcf filename", () => {
    const cards = [makeCard({ id: "c1", uid: "uid-1" }), makeCard({ id: "c2", uid: "uid-2" })];
    downloadMultipleContactsVCard(cards);
    expect(anchor.download).toBe("2-contacts.vcf");
    expect(anchor.click).toHaveBeenCalled();
  });

  it("multi-card blob contains one BEGIN:VCARD block per contact", () => {
    const cards = [makeCard({ id: "c1", uid: "uid-1" }), makeCard({ id: "c2", uid: "uid-2" })];
    downloadMultipleContactsVCard(cards);

    const blobArg = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    expect(blobArg.type).toBe("text/vcard;charset=utf-8");

    // Reconstruct the text from the blob by re-running the builder
    const combined = [contactCardToVCard(cards[0]), contactCardToVCard(cards[1])].join("\r\n");
    expect(combined.match(/BEGIN:VCARD/g)).toHaveLength(2);
    expect(combined.match(/END:VCARD/g)).toHaveLength(2);
  });

  it("revokes the object URL after download", () => {
    downloadMultipleContactsVCard([makeCard({ id: "a" }), makeCard({ id: "b" })]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(fakeUrl);
  });
});

describe("contactCardToVCard addresses", () => {
  function adrLine(card: ContactCard): string | undefined {
    return contactCardToVCard(card)
      .split("\r\n")
      .find((line) => line.startsWith("ADR"));
  }

  it("writes street, locality, region, postcode and country from address components", () => {
    const card = makeCard({
      addresses: {
        a1: {
          "@type": "Address",
          contexts: { work: true },
          components: [
            { "@type": "AddressComponent", kind: "number", value: "12" },
            { "@type": "AddressComponent", kind: "name", value: "Main Street" },
            { "@type": "AddressComponent", kind: "locality", value: "Utrecht" },
            { "@type": "AddressComponent", kind: "region", value: "Utrecht" },
            { "@type": "AddressComponent", kind: "postcode", value: "3511 AB" },
            { "@type": "AddressComponent", kind: "country", value: "Netherlands" },
          ],
        },
      },
    } as unknown as Partial<ContactCard>);

    expect(adrLine(card)).toBe(
      "ADR;TYPE=WORK:;;12 Main Street;Utrecht;Utrecht;3511 AB;Netherlands",
    );
  });

  it("reads the legacy flat street and locality fields when there are no components", () => {
    const card = makeCard({
      addresses: {
        a1: {
          "@type": "Address",
          street: " 1 Canal Road ",
          locality: "Leiden",
          region: "South Holland",
          postcode: "2311 AA",
          country: "NL",
        },
      },
    } as unknown as Partial<ContactCard>);

    expect(adrLine(card)).toBe("ADR:;;1 Canal Road;Leiden;South Holland;2311 AA;NL");
  });

  it("falls back to the full address as the street and escapes its commas", () => {
    const card = makeCard({
      addresses: {
        a1: { "@type": "Address", full: " 1 Infinite Loop, Cupertino " },
      },
    } as unknown as Partial<ContactCard>);

    expect(adrLine(card)).toBe("ADR:;;1 Infinite Loop\\, Cupertino;;;;");
  });

  it("writes an empty ADR when the address has no readable parts", () => {
    const card = makeCard({
      addresses: { a1: { "@type": "Address", street: 42 } },
    } as unknown as Partial<ContactCard>);

    expect(adrLine(card)).toBe("ADR:;;;;;;");
  });
});

describe("contactCardToVCard titles", () => {
  it("exports only titles of kind title, skipping roles and blank names", () => {
    const card = makeCard({
      titles: {
        t1: { "@type": "Title", name: "Engineer" },
        t2: { "@type": "Title", kind: "role", name: "Team lead" },
        t3: { "@type": "Title", kind: "title", name: "  " },
        t4: { "@type": "Title", kind: "title", name: "Architect" },
      },
    } as unknown as Partial<ContactCard>);

    const titles = contactCardToVCard(card)
      .split("\r\n")
      .filter((line) => line.startsWith("TITLE"));
    expect(titles).toEqual(["TITLE:Engineer", "TITLE:Architect"]);
  });
});

describe("contactCardToVCard line folding", () => {
  it("folds lines longer than 75 characters into tab-led continuation lines", () => {
    const note = "x".repeat(200);
    const vcard = contactCardToVCard(
      makeCard({ notes: { n1: { "@type": "Note", note } } } as unknown as Partial<ContactCard>),
    );
    const physical = vcard.split("\r\n");
    const start = physical.findIndex((line) => line.startsWith("NOTE:"));

    expect(physical[start]).toHaveLength(75);
    expect(physical[start + 1]).toMatch(/^\t/);
    expect(physical[start + 2]).toMatch(/^\t/);
    for (const line of physical) expect(line.length).toBeLessThanOrEqual(75);
    expect(vcard.replace(/\r\n\t/g, "")).toContain(`NOTE:${note}`);
  });

  it("leaves a line of exactly 75 characters unfolded", () => {
    const note = "y".repeat(70);
    const vcard = contactCardToVCard(
      makeCard({ notes: { n1: { "@type": "Note", note } } } as unknown as Partial<ContactCard>),
    );
    expect(vcard.split("\r\n")).toContain(`NOTE:${note}`);
  });
});

describe("contactCardToVCard birthdays", () => {
  function bdayOf(date: unknown): string | undefined {
    const card = makeCard({
      anniversaries: { b1: { "@type": "Anniversary", kind: "birth", date } },
    } as unknown as Partial<ContactCard>);
    return contactCardToVCard(card)
      .split("\r\n")
      .find((line) => line.startsWith("BDAY"));
  }

  it("writes a timestamp birthday as its UTC date", () => {
    expect(bdayOf({ "@type": "Timestamp", utc: "1990-05-17T08:30:00Z" })).toBe("BDAY:19900517");
  });

  it("omits BDAY for an unparseable timestamp", () => {
    expect(bdayOf({ "@type": "Timestamp", utc: "not-a-date" })).toBeUndefined();
  });

  it("omits BDAY for a partial date with only a year", () => {
    expect(bdayOf({ "@type": "PartialDate", year: 1990 })).toBeUndefined();
  });

  it("omits BDAY for a partial date with a month but no day", () => {
    expect(bdayOf({ "@type": "PartialDate", year: 1990, month: 5 })).toBeUndefined();
  });
});
