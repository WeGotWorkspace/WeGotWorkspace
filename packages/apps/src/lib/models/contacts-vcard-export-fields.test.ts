import { describe, expect, it } from "vitest";
import { contactCardToVCard } from "@/lib/models/contacts-vcard-export";
import type { ContactCard } from "@/lib/models/contacts-types";

const card = (over: Record<string, unknown>) =>
  ({ id: "c", name: { full: "Ada" }, ...over }) as unknown as ContactCard;

const lines = (c: ContactCard) => contactCardToVCard(c).split("\r\n");

describe("contactCardToVCard fields", () => {
  it("writes TITLE, typed EMAIL/TEL, and skips non-title titles and empty orgs", () => {
    const out = lines(
      card({
        titles: {
          a: { name: "CEO", kind: "title" },
          b: { name: "Boss", kind: "role" },
          c: { kind: "title" },
        },
        organizations: { o1: {}, o2: { name: "Acme", units: [{ name: "R&D" }, {}] } },
        emails: { e: { address: "a@b.test", contexts: { work: true } } },
        phones: { p: { number: "1", contexts: { private: true }, features: { mobile: true } } },
      }),
    );
    expect(out).toContain("TITLE:CEO");
    expect(out.filter((l) => l.startsWith("TITLE"))).toHaveLength(1);
    expect(out).toContain("ORG:Acme;R&D");
    expect(out.filter((l) => l.startsWith("ORG"))).toHaveLength(1);
    expect(out).toContain("EMAIL;TYPE=WORK:a@b.test");
    expect(out).toContain("TEL;TYPE=PRIVATE,MOBILE:1");
  });

  it("writes ADR from components, legacy fields and the full string", () => {
    const out = lines(
      card({
        addresses: {
          a: {
            components: [
              { kind: "name", value: "Main" },
              { kind: "number", value: "5" },
              { kind: "locality", value: "Town" },
              { kind: "region", value: "R" },
              { kind: "postcode", value: "1" },
              { kind: "country", value: "NL" },
            ],
            contexts: { work: true },
          },
          b: { street: "Legacy", locality: "L", region: "G", postcode: "2", country: "BE" },
          c: { full: "Somewhere" },
        },
      }),
    );
    expect(out).toContain("ADR;TYPE=WORK:;;5 Main;Town;R;1;NL");
    expect(out).toContain("ADR:;;Legacy;L;G;2;BE");
    expect(out).toContain("ADR:;;Somewhere;;;;");
  });

  it("writes BDAY from timestamps and rejects incomplete dates", () => {
    const bday = (date: unknown) =>
      lines(card({ anniversaries: { b: { kind: "birth", date } } })).find((l) =>
        l.startsWith("BDAY"),
      );
    expect(bday({ "@type": "Timestamp", utc: "2001-02-03T00:00:00Z" })).toBe("BDAY:20010203");
    expect(bday({ "@type": "Timestamp", utc: "bad" })).toBeUndefined();
    expect(bday({ "@type": "PartialDate", year: 2001 })).toBeUndefined();
  });

  it("folds long lines at 75 characters", () => {
    const out = lines(card({ notes: { n: { note: "x".repeat(200) } } }));
    const noteIdx = out.findIndex((l) => l.startsWith("NOTE:"));
    expect(out[noteIdx]).toHaveLength(75);
    expect(out[noteIdx + 1].startsWith("\t")).toBe(true);
  });
});
