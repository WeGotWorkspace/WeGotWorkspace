import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContactCard } from "@/lib/models/contacts-types";
import {
  contactCardToEditDraft,
  editDraftToPatch,
  newContactMapId,
} from "@/lib/models/contacts-edit-draft";

function cardWith(fields: Record<string, unknown>): ContactCard {
  return {
    "@type": "Card",
    version: "1.0",
    id: "card-1",
    uid: "urn:uuid:1",
    addressBookIds: { default: true },
    kind: "individual",
    ...fields,
  } as unknown as ContactCard;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newContactMapId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses crypto.randomUUID when the runtime has it", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "11111111-2222-4333-8444-555555555555" });
    expect(newContactMapId()).toBe("11111111-2222-4333-8444-555555555555");
  });

  it("builds a version 4 UUID from getRandomValues when randomUUID is missing", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0xff);
        return bytes;
      },
    });
    const id = newContactMapId();
    expect(id).toMatch(UUID_V4);
    expect(id).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  });

  it("falls back to distinct counter ids without any crypto", () => {
    vi.stubGlobal("crypto", undefined);
    const first = newContactMapId();
    const second = newContactMapId();
    expect(first).toMatch(/^contact-[0-9a-z]+-[0-9a-z]+$/);
    expect(second).toMatch(/^contact-[0-9a-z]+-[0-9a-z]+$/);
    expect(second).not.toBe(first);
  });
});

describe("contactCardToEditDraft", () => {
  it("reads a phone stored as a tel: uri, and an empty number when it has neither", () => {
    const draft = contactCardToEditDraft(
      cardWith({
        phones: {
          p1: { "@type": "Phone", uri: " tel:+31201234567 " },
          p2: { "@type": "Phone" },
        },
      }),
    );
    expect(draft.phones).toEqual([
      { id: "p1", number: "tel:+31201234567", phoneType: "" },
      { id: "p2", number: "", phoneType: "" },
    ]);
  });

  it("reads a timestamp birthday as an ISO date in UTC", () => {
    const draft = contactCardToEditDraft(
      cardWith({
        anniversaries: {
          b1: {
            "@type": "Anniversary",
            kind: "birth",
            date: { "@type": "Timestamp", utc: "1984-02-09T23:30:00Z" },
          },
        },
      }),
    );
    expect(draft.birthday).toBe("1984-02-09");
    expect(draft.birthdayId).toBe("b1");
  });

  it("reads an unparseable timestamp birthday as empty", () => {
    const draft = contactCardToEditDraft(
      cardWith({
        anniversaries: {
          b1: {
            "@type": "Anniversary",
            kind: "birth",
            date: { "@type": "Timestamp", utc: "garbage" },
          },
        },
      }),
    );
    expect(draft.birthday).toBe("");
    expect(draft.birthdayId).toBe("b1");
  });

  it("reads address components and the full-address fallback", () => {
    const draft = contactCardToEditDraft(
      cardWith({
        addresses: {
          a1: {
            "@type": "Address",
            contexts: { private: true },
            components: [
              { kind: "number", value: "12" },
              { kind: "name", value: "Main Street" },
              { kind: "locality", value: "Utrecht" },
              { kind: "postcode", value: "3511 AB" },
              { kind: "country", value: "NL" },
            ],
          },
          a2: { "@type": "Address", components: [{ kind: "number", value: "7" }] },
          a3: { "@type": "Address", full: " Somewhere 1, Delft " },
          a4: { "@type": "Address" },
        },
      }),
    );
    expect(draft.addresses).toEqual([
      {
        id: "a1",
        street: "12 Main Street",
        locality: "Utrecht",
        region: "",
        postalCode: "3511 AB",
        country: "NL",
        contextType: "home",
      },
      {
        id: "a2",
        street: "7",
        locality: "",
        region: "",
        postalCode: "",
        country: "",
        contextType: "",
      },
      {
        id: "a3",
        street: "Somewhere 1, Delft",
        locality: "",
        region: "",
        postalCode: "",
        country: "",
        contextType: "",
      },
      {
        id: "a4",
        street: "",
        locality: "",
        region: "",
        postalCode: "",
        country: "",
        contextType: "",
      },
    ]);
  });
});

describe("editDraftToPatch channel maps", () => {
  const withPhones = cardWith({
    phones: {
      p1: { "@type": "Phone", number: "+31 1" },
      p2: { "@type": "Phone", number: "+31 2" },
    },
  });

  it("deletes a phone row the person removed from the draft", () => {
    const draft = contactCardToEditDraft(withPhones);
    draft.phones = draft.phones.filter((row) => row.id !== "p2");
    expect(editDraftToPatch(draft, withPhones)).toEqual({ phones: { p2: null } });
  });

  it("deletes a phone whose number the person cleared", () => {
    const draft = contactCardToEditDraft(withPhones);
    draft.phones = draft.phones.map((row) => (row.id === "p1" ? { ...row, number: "  " } : row));
    expect(editDraftToPatch(draft, withPhones)).toEqual({ phones: { p1: null } });
  });

  it("adds a new address with its context", () => {
    const active = cardWith({});
    const draft = contactCardToEditDraft(active);
    draft.addresses = [
      {
        id: "new-a",
        street: " Main Street 1 ",
        locality: "Utrecht",
        region: "UT",
        postalCode: "3511",
        country: "NL",
        contextType: "work",
      },
    ];
    expect(editDraftToPatch(draft, active)).toEqual({
      addresses: {
        "new-a": {
          components: [
            { kind: "name", value: "Main Street 1" },
            { kind: "locality", value: "Utrecht" },
            { kind: "region", value: "UT" },
            { kind: "postcode", value: "3511" },
            { kind: "country", value: "NL" },
          ],
          isOrdered: false,
          contexts: { work: true },
        },
      },
    });
  });

  it("sends nothing for an unchanged address and rewrites one whose context changed", () => {
    const active = cardWith({
      addresses: {
        a1: {
          "@type": "Address",
          components: [
            { kind: "name", value: "Main Street 1" },
            { kind: "locality", value: "Utrecht" },
          ],
        },
      },
    });
    const unchanged = contactCardToEditDraft(active);
    expect(editDraftToPatch(unchanged, active)).toEqual({});

    const moved = contactCardToEditDraft(active);
    moved.addresses = moved.addresses.map((row) => ({ ...row, contextType: "home" }));
    expect(editDraftToPatch(moved, active)).toEqual({
      addresses: {
        a1: {
          components: [
            { kind: "name", value: "Main Street 1" },
            { kind: "locality", value: "Utrecht" },
          ],
          isOrdered: false,
          contexts: { private: true },
        },
      },
    });
  });

  it("patches website links but never touches contact-kind links", () => {
    const active = cardWith({
      links: {
        l1: { "@type": "Link", uri: "https://old.example.test" },
        l2: { "@type": "Link", kind: "contact", uri: "mailto:x@example.test" },
        l3: { "@type": "Link", uri: "https://keep.example.test", contexts: { work: true } },
      },
    });
    const draft = contactCardToEditDraft(active);
    expect(draft.urls.map((row) => row.id)).toEqual(["l1", "l3"]);

    draft.urls = [
      { id: "l1", uri: " https://new.example.test ", contextType: "school" },
      { id: "l3", uri: "https://keep.example.test", contextType: "work" },
      { id: "l4", uri: "https://added.example.test", contextType: "" },
    ];
    expect(editDraftToPatch(draft, active)).toEqual({
      links: {
        l1: { uri: "https://new.example.test", contexts: { school: true } },
        l4: { uri: "https://added.example.test" },
      },
    });
  });
});

describe("editDraftToPatch organization, title and note", () => {
  it("deletes the organization when both name and department are cleared", () => {
    const active = cardWith({
      organizations: { o1: { "@type": "Organization", name: "Acme" } },
    });
    const draft = { ...contactCardToEditDraft(active), organization: "", department: "" };
    expect(editDraftToPatch(draft, active)).toEqual({ organizations: { o1: null } });
  });

  it("keeps the other units when the department is cleared", () => {
    const active = cardWith({
      organizations: {
        o1: {
          "@type": "Organization",
          name: "Acme",
          units: [{ name: "Sales" }, { name: "EMEA" }],
        },
      },
    });
    const draft = { ...contactCardToEditDraft(active), department: "" };
    expect(editDraftToPatch(draft, active)).toEqual({
      organizations: { o1: { name: "Acme", units: [{ name: "EMEA" }] } },
    });
  });

  it("removes the units when the only department is cleared", () => {
    const active = cardWith({
      organizations: { o1: { "@type": "Organization", name: "Acme", units: [{ name: "Sales" }] } },
    });
    const draft = { ...contactCardToEditDraft(active), department: "" };
    expect(editDraftToPatch(draft, active)).toEqual({
      organizations: { o1: { name: "Acme", units: null } },
    });
  });

  it("clears the organization name but keeps the department", () => {
    const active = cardWith({
      organizations: { o1: { "@type": "Organization", name: "Acme", units: [{ name: "Sales" }] } },
    });
    const draft = { ...contactCardToEditDraft(active), organization: "" };
    expect(editDraftToPatch(draft, active)).toEqual({
      organizations: { o1: { name: null, units: [{ name: "Sales" }] } },
    });
  });

  it("deletes the title when it is cleared", () => {
    const active = cardWith({ titles: { t1: { "@type": "Title", name: "Engineer" } } });
    const draft = { ...contactCardToEditDraft(active), title: " " };
    expect(editDraftToPatch(draft, active)).toEqual({ titles: { t1: null } });
  });

  it("deletes the note when it is cleared", () => {
    const active = cardWith({ notes: { n1: { "@type": "Note", note: "Met at the fair" } } });
    const draft = { ...contactCardToEditDraft(active), notes: "" };
    expect(editDraftToPatch(draft, active)).toEqual({ notes: { n1: null } });
  });
});

describe("contact edit draft edge rows", () => {
  it("drafts a null address slot as one empty address row", () => {
    expect(contactCardToEditDraft(cardWith({ addresses: { a1: null } })).addresses).toEqual([
      {
        id: "a1",
        street: "",
        locality: "",
        region: "",
        postalCode: "",
        country: "",
        contextType: "",
      },
    ]);
  });

  it("drafts a phone with the mobile feature as a mobile phone", () => {
    const draft = contactCardToEditDraft(
      cardWith({ phones: { p1: { "@type": "Phone", number: "1", features: { mobile: true } } } }),
    );
    expect(draft.phones).toEqual([{ id: "p1", number: "1", phoneType: "mobile" }]);
  });

  it("sends nothing for an empty phone row whose stored slot is null", () => {
    const active = cardWith({ phones: { p1: null } });
    const draft = {
      ...contactCardToEditDraft(cardWith({})),
      phones: [{ id: "p1", number: "", phoneType: "" as const }],
    };
    expect(editDraftToPatch(draft, active)).toEqual({});
  });

  it("sends no anniversaries patch for an impossible birthday", () => {
    const active = cardWith({});
    const draft = { ...contactCardToEditDraft(active), birthday: "1985-13-40" };
    expect(editDraftToPatch(draft, active)).toEqual({});
    expect(editDraftToPatch({ ...draft, birthday: "1985-02-40" }, active)).toEqual({});
    expect(
      editDraftToPatch({ ...draft, birthday: "1985-02-14" }, active).anniversaries,
    ).toBeDefined();
  });
});
