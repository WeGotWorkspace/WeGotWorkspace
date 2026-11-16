import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addressDraftToPatchValue,
  birthdayEntryFromIso,
  contactCardToEditDraft,
  contactContextToPatch,
  editDraftToPatch,
  newContactMapId,
  phoneTypeToPatch,
  readContactContext,
  readPhoneType,
  type ContactEditDraft,
} from "@/lib/models/contacts-edit-draft";
import type { ContactCard } from "@/lib/models/contacts-types";

const card = (over: Record<string, unknown>) => over as unknown as ContactCard;

function emptyDraft(over: Partial<ContactEditDraft> = {}): ContactEditDraft {
  return {
    nameGiven: "",
    nameGiven2: "",
    nameSurname: "",
    showGiven2: false,
    showAsCompany: false,
    phones: [],
    emails: [],
    addresses: [],
    urls: [],
    title: "",
    department: "",
    organization: "",
    notes: "",
    birthday: "",
    ...over,
  };
}

const richCard = card({
  name: {
    components: [
      { kind: "given", value: "Ada" },
      { kind: "given2", value: "M" },
      { kind: "surname", value: "Lovelace" },
    ],
  },
  phones: {
    p1: { number: " 123 ", features: { mobile: true } },
    p2: { uri: "tel:456", contexts: { work: true } },
    p3: {},
  },
  emails: { e1: { address: " a@b.test ", contexts: { private: true } } },
  addresses: {
    a1: {
      components: [
        { kind: "name", value: "Main St" },
        { kind: "number", value: "5" },
        { kind: "locality", value: "Town" },
        { kind: "region", value: "R" },
        { kind: "postcode", value: "123" },
        { kind: "country", value: "NL" },
      ],
      contexts: { school: true },
    },
    a2: { full: " Somewhere " },
    a3: { components: [{ kind: "number", value: "7" }] },
    a4: { components: [{ kind: "name", value: "Only" }] },
    a5: {},
  },
  links: {
    l1: { uri: " https://x.test ", contexts: { work: true } },
    l2: { kind: "contact", uri: "x" },
  },
  kind: "org",
  titles: { t1: { name: " CEO ", kind: "title" } },
  organizations: { o1: { name: " Acme ", units: [{ name: "R&D" }, { name: "Lab" }] } },
  notes: { n1: { note: " hi " } },
  anniversaries: {
    b1: { kind: "birth", date: { "@type": "PartialDate", year: 1815, month: 12, day: 10 } },
  },
});

describe("contacts-edit-draft", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("newContactMapId falls back through getRandomValues to a counter", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "uuid" });
    expect(newContactMapId()).toBe("uuid");
    vi.stubGlobal("crypto", {
      getRandomValues: (b: Uint8Array) => {
        b.fill(1);
        return b;
      },
    });
    expect(newContactMapId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-/);
    vi.stubGlobal("crypto", undefined);
    expect(newContactMapId()).toMatch(/^contact-/);
  });

  it("maps contexts and phone types both ways", () => {
    expect(readContactContext({ work: true })).toBe("work");
    expect(readContactContext({ home: true })).toBe("home");
    expect(readContactContext({ school: true })).toBe("school");
    expect(readContactContext(undefined)).toBe("");
    expect(contactContextToPatch("work")).toEqual({ work: true });
    expect(contactContextToPatch("home")).toEqual({ private: true });
    expect(contactContextToPatch("school")).toEqual({ school: true });
    expect(contactContextToPatch("")).toBeUndefined();
    expect(readPhoneType({ features: { mobile: true } })).toBe("mobile");
    expect(readPhoneType(null)).toBe("");
    expect(phoneTypeToPatch("mobile")).toEqual({ features: { mobile: true }, contexts: null });
    expect(phoneTypeToPatch("work")).toEqual({ contexts: { work: true }, features: null });
    expect(phoneTypeToPatch("")).toEqual({ contexts: null, features: null });
  });

  it("addressDraftToPatchValue and birthdayEntryFromIso", () => {
    const row = {
      id: "a",
      street: " S ",
      locality: "L",
      region: "R",
      postalCode: "P",
      country: "C",
      contextType: "work" as const,
    };
    expect(addressDraftToPatchValue(row)).toEqual({
      components: [
        { kind: "name", value: "S" },
        { kind: "locality", value: "L" },
        { kind: "region", value: "R" },
        { kind: "postcode", value: "P" },
        { kind: "country", value: "C" },
      ],
      isOrdered: false,
      contexts: { work: true },
    });
    expect(
      addressDraftToPatchValue({
        ...row,
        street: "",
        locality: "",
        region: "",
        postalCode: "",
        country: "",
        contextType: "",
      }),
    ).toEqual({ components: [], isOrdered: false });
    expect(birthdayEntryFromIso("2000-02-03")).toEqual({
      "@type": "Anniversary",
      kind: "birth",
      date: { "@type": "PartialDate", year: 2000, month: 2, day: 3 },
    });
    expect(birthdayEntryFromIso("nope")).toBeUndefined();
    expect(birthdayEntryFromIso("2000-13-03")).toBeUndefined();
    expect(birthdayEntryFromIso("2000-01-32")).toBeUndefined();
  });

  it("contactCardToEditDraft reads a full card", () => {
    const draft = contactCardToEditDraft(richCard);
    expect(draft).toMatchObject({
      nameGiven: "Ada",
      nameGiven2: "M",
      nameSurname: "Lovelace",
      showGiven2: true,
      showAsCompany: true,
      title: "CEO",
      titleId: "t1",
      organization: "Acme",
      department: "R&D",
      organizationId: "o1",
      notes: "hi",
      notesId: "n1",
      birthday: "1815-12-10",
      birthdayId: "b1",
    });
    expect(draft.phones.map((p) => [p.number, p.phoneType])).toEqual([
      ["123", "mobile"],
      ["tel:456", "work"],
      ["", ""],
    ]);
    expect(draft.emails[0]).toMatchObject({ address: "a@b.test", contextType: "home" });
    expect(draft.urls).toEqual([{ id: "l1", uri: "https://x.test", contextType: "work" }]);
    const streets = draft.addresses.map((a) => a.street);
    expect(streets).toEqual(["5 Main St", "Somewhere", "7", "Only", ""]);
    expect(draft.addresses[0]).toMatchObject({
      locality: "Town",
      region: "R",
      postalCode: "123",
      country: "NL",
      contextType: "school",
    });
  });

  it("contactCardToEditDraft splits a full name and tolerates an empty card", () => {
    const split = contactCardToEditDraft(card({ name: { full: "Grace Hopper" } }));
    expect([split.nameGiven, split.nameSurname]).toEqual(["Grace", "Hopper"]);
    const empty = contactCardToEditDraft(card({}));
    expect(empty).toMatchObject({
      title: "",
      organization: "",
      notes: "",
      birthday: "",
      showAsCompany: false,
    });
    const fallbackTitle = contactCardToEditDraft(
      card({ titles: { t: { name: "Role", kind: "role" } } }),
    );
    expect(fallbackTitle.title).toBe("Role");
  });

  it("birthday reads timestamps and incomplete dates", () => {
    const ts = (date: unknown) =>
      contactCardToEditDraft(card({ anniversaries: { b: { kind: "birth", date } } })).birthday;
    expect(ts({ "@type": "Timestamp", utc: "2001-02-03T00:00:00Z" })).toBe("2001-02-03");
    expect(ts({ "@type": "Timestamp", utc: "bad" })).toBe("");
    expect(ts({ "@type": "PartialDate", year: 2001 })).toBe("");
    expect(ts(undefined)).toBe("");
  });

  it("editDraftToPatch is empty for an unchanged draft", () => {
    expect(editDraftToPatch(contactCardToEditDraft(richCard), richCard)).toEqual({});
  });

  it("editDraftToPatch removes cleared and dropped rows", () => {
    const draft = contactCardToEditDraft(richCard);
    draft.phones = draft.phones
      .filter((p) => p.id !== "p1")
      .map((p) => (p.id === "p2" ? { ...p, number: "" } : p));
    draft.emails = [];
    draft.addresses = [];
    draft.urls = [];
    draft.organization = "";
    draft.department = "";
    draft.title = "";
    draft.notes = "";
    draft.birthday = "";
    const patch = editDraftToPatch(draft, richCard);
    expect(patch.phones).toEqual({ p1: null, p2: null });
    expect(patch.emails).toEqual({ e1: null });
    expect(patch.addresses).toMatchObject({ a1: null });
    expect(patch.links).toEqual({ l1: null });
    expect(patch.organizations).toEqual({ o1: null });
    expect(patch.titles).toEqual({ t1: null });
    expect(patch.notes).toEqual({ n1: null });
    expect(patch.anniversaries).toEqual({ b1: null });
  });

  it("editDraftToPatch writes edited and new values", () => {
    const draft = contactCardToEditDraft(richCard);
    draft.showAsCompany = false;
    draft.phones = [
      ...draft.phones.map((p) =>
        p.id === "p1" ? { ...p, number: "999", phoneType: "work" as const } : p,
      ),
      { id: "new", number: " 5 ", phoneType: "" },
    ];
    draft.addresses = [
      ...draft.addresses,
      {
        id: "new-addr",
        street: "Fresh",
        locality: "",
        region: "",
        postalCode: "",
        country: "",
        contextType: "",
      },
    ];
    draft.emails = [{ id: "e1", address: "z@b.test", contextType: "work" }];
    draft.urls = [{ id: "l1", uri: "https://y.test", contextType: "" }];
    draft.organization = "Beta";
    draft.department = "";
    draft.title = "CTO";
    draft.notes = "changed";
    draft.birthday = "1900-01-02";
    const patch = editDraftToPatch(draft, richCard);
    expect(patch.kind).toBe("individual");
    expect(patch.phones).toMatchObject({ p1: { number: "999" }, new: { number: "5" } });
    expect(patch.emails).toEqual({ e1: { address: "z@b.test", contexts: { work: true } } });
    expect(patch.addresses).toMatchObject({ "new-addr": { isOrdered: false } });
    expect(patch.links).toEqual({ l1: { uri: "https://y.test" } });
    expect(patch.organizations).toEqual({
      o1: { name: "Beta", units: [{ name: "R&D" }, { name: "Lab" }].slice(1) },
    });
    expect(patch.titles).toEqual({ t1: { name: "CTO", kind: "title" } });
    expect(patch.notes).toEqual({ n1: { note: "changed" } });
    expect(Object.keys(patch.anniversaries ?? {})).toEqual(["b1"]);
  });

  it("editDraftToPatch builds organization, title, note and birthday on a bare card", () => {
    const bare = card({ kind: "group" });
    const patch = editDraftToPatch(
      emptyDraft({
        organization: "Org",
        department: "Dept",
        title: "T",
        notes: "N",
        birthday: "2000-01-01",
        showAsCompany: true,
      }),
      bare,
    );
    expect(patch.kind).toBeUndefined();
    expect(Object.values(patch.organizations ?? {})[0]).toEqual({
      name: "Org",
      units: [{ name: "Dept" }],
    });
    expect(Object.values(patch.titles ?? {})[0]).toEqual({ name: "T", kind: "title" });
    expect(Object.values(patch.notes ?? {})[0]).toEqual({ note: "N" });
    expect(Object.keys(patch.anniversaries ?? {})).toHaveLength(1);
    expect(
      editDraftToPatch(emptyDraft({ birthday: "garbage" }), bare).anniversaries,
    ).toBeUndefined();
  });

  it("editDraftToPatch clears an organization name or department independently", () => {
    const org = card({ organizations: { o: { name: "Acme", units: [{ name: "D" }] } } });
    const noName = editDraftToPatch(emptyDraft({ organization: "", department: "D" }), org);
    expect(noName.organizations).toEqual({ o: { units: [{ name: "D" }], name: null } });
    const noDept = editDraftToPatch(emptyDraft({ organization: "Acme", department: "" }), org);
    expect(noDept.organizations).toEqual({ o: { name: "Acme", units: null } });
  });
});
