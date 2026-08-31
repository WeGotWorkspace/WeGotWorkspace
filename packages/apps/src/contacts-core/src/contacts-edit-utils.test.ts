import { describe, expect, it } from "vitest";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import {
  canCreateContactInView,
  contactCardToEditDraft,
  contactEditDraftHasContent,
  editDraftToCreateBody,
  editDraftToPatch,
  emptyContactEditDraft,
  resolveCreateAddressBookIds,
  resolveDefaultContactsView,
} from "./contacts-edit-utils";

const janeCard = {
  "@type": "Card",
  version: "1.0",
  id: "card-jane",
  uid: "urn:uuid:jane-example",
  addressBookIds: { default: true as const },
  name: { "@type": "Name" as const, isOrdered: false, full: "Jane Doe" },
  organizations: {
    "org-1": { "@type": "Organization" as const, name: "Acme Corp" },
  },
  emails: {
    "email-1": { "@type": "EmailAddress" as const, address: "jane@example.com" },
  },
  phones: {
    "phone-1": { "@type": "Phone" as const, number: "+1-555-0101", contexts: { work: true } },
  },
  notes: {
    "note-1": { "@type": "Note" as const, note: "Met at conference" },
  },
} as unknown as ContactCard;

describe("contacts-edit-utils", () => {
  it("resolves default view as all contacts regardless of address books", () => {
    expect(
      resolveDefaultContactsView([
        { id: "work", name: "Work", isDefault: false } as never,
        { id: "default", name: "Default", isDefault: true } as never,
      ]),
    ).toBe("all");
    expect(
      resolveDefaultContactsView([{ id: "work", name: "Work", isDefault: false } as never]),
    ).toBe("all");
    expect(resolveDefaultContactsView([])).toBe("all");
  });

  it("maps create address book ids from active book or default", () => {
    const books = [
      { id: "default", name: "Default", isDefault: true } as never,
      { id: "work", name: "Work", isDefault: false } as never,
    ];
    expect(resolveCreateAddressBookIds("book:work", books)).toEqual({ work: true });
    expect(resolveCreateAddressBookIds("book:shared-42", books)).toEqual({ "shared-42": true });
    expect(resolveCreateAddressBookIds("all", books)).toEqual({ default: true });
    expect(
      resolveCreateAddressBookIds("group:card-group-friends", books, [
        { id: "card-group-friends", addressBookIds: { work: true as const } },
      ]),
    ).toEqual({ work: true });
    expect(resolveCreateAddressBookIds("group:missing", books, [])).toEqual({ default: true });
  });

  it("enables New on writable group views and disables it on view-only books", () => {
    const writable = [{ id: "default", myRights: { mayWrite: true } }];
    const viewOnly = [{ id: "shared-42", myRights: { mayWrite: false } }];
    expect(
      canCreateContactInView("group:card-group-friends", writable, {
        addressBookIds: { default: true },
      }),
    ).toBe(true);
    expect(
      canCreateContactInView("group:card-group-shared", viewOnly, {
        addressBookIds: { "shared-42": true },
      }),
    ).toBe(false);
    expect(canCreateContactInView("book:shared-42", viewOnly)).toBe(false);
    expect(canCreateContactInView("book:default", writable)).toBe(true);
    expect(canCreateContactInView("all", [])).toBe(false);
  });

  it("builds create body with JSContact name components", () => {
    const draft = {
      ...emptyContactEditDraft(),
      nameGiven: "New",
      nameSurname: "Person",
      phones: [{ id: "phone-new", number: "+1-555-9999", phoneType: "work" as const }],
      emails: [{ id: "email-new", address: "new@example.com", contextType: "" as const }],
    };
    const body = editDraftToCreateBody(draft, { default: true });
    expect(body).not.toHaveProperty("@type");
    expect(body).not.toHaveProperty("version");
    expect(body).not.toHaveProperty("id");
    expect(body.addressBookIds).toEqual({ default: true });
    expect(body.name).toEqual({
      isOrdered: false,
      components: [
        { kind: "given", value: "New" },
        { kind: "surname", value: "Person" },
      ],
      full: "New Person",
    });
    expect(body.phones).toEqual({
      "phone-new": { number: "+1-555-9999", contexts: { work: true } },
    });
  });

  it("maps mobile phone type to JSContact features.mobile", () => {
    const draft = {
      ...emptyContactEditDraft(),
      phones: [{ id: "phone-m", number: "+31612345678", phoneType: "mobile" as const }],
    };
    const body = editDraftToCreateBody(draft, { default: true });
    expect(body.phones).toEqual({
      "phone-m": { number: "+31612345678", features: { mobile: true } },
    });
  });

  it("round-trips job title and department through draft create/patch", () => {
    const card = {
      ...janeCard,
      titles: {
        "title-1": { "@type": "Title" as const, kind: "title" as const, name: "Engineer" },
      },
      organizations: {
        "org-1": {
          "@type": "Organization" as const,
          name: "Acme Corp",
          units: [{ "@type": "OrgUnit" as const, name: "Platform" }],
        },
      },
    } as unknown as ContactCard;
    const draft = contactCardToEditDraft(card);
    expect(draft.title).toBe("Engineer");
    expect(draft.department).toBe("Platform");
    expect(draft.organization).toBe("Acme Corp");
    draft.title = "Staff Engineer";
    draft.department = "Infrastructure";
    const patch = editDraftToPatch(draft, card);
    expect(patch.titles).toEqual({
      "title-1": { name: "Staff Engineer", kind: "title" },
    });
    expect(patch.organizations).toEqual({
      "org-1": {
        name: "Acme Corp",
        units: [{ name: "Infrastructure" }],
      },
    });
  });

  it("round-trips card to draft and builds patch for changed phone", () => {
    const draft = contactCardToEditDraft(janeCard);
    expect(draft.nameGiven).toBe("Jane");
    expect(draft.nameSurname).toBe("Doe");
    draft.phones = [{ id: "phone-1", number: "+1-555-0199", phoneType: "work" }];
    const patch = editDraftToPatch(draft, janeCard);
    expect(patch.phones).toEqual({
      "phone-1": { number: "+1-555-0199", contexts: { work: true }, features: null },
    });
    expect(patch).not.toHaveProperty("@type");
  });

  it("maps school context in patch", () => {
    const draft = contactCardToEditDraft(janeCard);
    draft.phones = [{ id: "phone-1", number: "+1-555-0101", phoneType: "school" }];
    const patch = editDraftToPatch(draft, janeCard);
    expect(patch.phones).toEqual({
      "phone-1": { number: "+1-555-0101", contexts: { school: true }, features: null },
    });
  });

  it("round-trips links as urls in edit draft", () => {
    const cardWithLinks = {
      ...janeCard,
      links: {
        "link-1": {
          "@type": "Link" as const,
          uri: "https://example.com",
          contexts: { work: true },
        },
      },
    } as unknown as ContactCard;
    const draft = contactCardToEditDraft(cardWithLinks);
    expect(draft.urls).toEqual([{ id: "link-1", uri: "https://example.com", contextType: "work" }]);
  });

  it("patches company contact kind", () => {
    const draft = contactCardToEditDraft(janeCard);
    draft.showAsCompany = true;
    const patch = editDraftToPatch(draft, janeCard);
    expect(patch.kind).toBe("org");
  });

  it("does not overwrite group kind when editing a group card", () => {
    const groupCard = {
      "@type": "Card",
      version: "1.0",
      id: "card-friends",
      uid: "urn:uuid:08430ef3-a2ce-4568-9d6c-f50a6cfd32ae",
      kind: "group" as const,
      addressBookIds: { default: true as const },
      name: { "@type": "Name" as const, isOrdered: false, full: "Friends" },
      members: { "urn:uuid:c4cf6038-5da0-41be-9c2d-d8cb9b4af90f": true as const },
    } as unknown as ContactCard;

    // Simulate what happens when the user opens the edit form for a group card
    // and saves without making any changes.
    const draft = contactCardToEditDraft(groupCard);
    const patch = editDraftToPatch(draft, groupCard);

    // The patch must NOT include kind — that would silently downgrade the group to "individual".
    expect(patch).not.toHaveProperty("kind");
  });

  it("does not include kind in patch when group card edit form showAsCompany is false", () => {
    const groupCard = {
      "@type": "Card",
      version: "1.0",
      id: "card-coworkers",
      uid: "urn:uuid:ffffffff-ffff-4fff-8fff-ffffffffffff",
      kind: "group" as const,
      addressBookIds: { work: true as const },
      name: { "@type": "Name" as const, isOrdered: false, full: "Coworkers" },
      members: {},
    } as unknown as ContactCard;

    const draft = contactCardToEditDraft(groupCard);
    // showAsCompany will be false for group cards (they are not "org" kind)
    expect(draft.showAsCompany).toBe(false);

    const patch = editDraftToPatch(draft, groupCard);
    // Even though showAsCompany=false would compute nextKind="individual",
    // the patch must not touch kind for a group card.
    expect(patch).not.toHaveProperty("kind");
  });

  it("builds create body with company kind and urls", () => {
    const draft = {
      ...emptyContactEditDraft(),
      showAsCompany: true,
      urls: [{ id: "url-1", uri: "https://example.com", contextType: "home" as const }],
    };
    const body = editDraftToCreateBody(draft, { default: true });
    expect(body.kind).toBe("org");
    expect(body.links).toEqual({
      "url-1": { uri: "https://example.com", contexts: { private: true } },
    });
  });

  it("builds notes patch with note key per OpenAPI JsContactNote", () => {
    const draft = contactCardToEditDraft(janeCard);
    draft.notes = "Updated note text";
    const patch = editDraftToPatch(draft, janeCard);
    expect(patch.notes).toEqual({ "note-1": { note: "Updated note text" } });
  });

  it("builds notes patch when adding a note to a card without notes", () => {
    const cardWithoutNotes = { ...janeCard, notes: undefined };
    const draft = contactCardToEditDraft(cardWithoutNotes);
    draft.notes = "Brand new note";
    const patch = editDraftToPatch(draft, cardWithoutNotes);
    expect(patch.notes).toBeDefined();
    const [noteId, noteEntry] = Object.entries(patch.notes ?? {})[0] ?? [];
    expect(noteId).toBeTruthy();
    expect(noteEntry).toEqual({ note: "Brand new note" });
  });

  it("builds structured address patch with JSContact components", () => {
    const cardWithAddress = {
      ...janeCard,
      addresses: {
        "addr-1": {
          "@type": "Address" as const,
          components: [
            { kind: "name" as const, value: "123 Main St" },
            { kind: "locality" as const, value: "Springfield" },
            { kind: "region" as const, value: "IL" },
            { kind: "postcode" as const, value: "62704" },
            { kind: "country" as const, value: "USA" },
          ],
          contexts: { private: true },
        },
      },
    } as unknown as ContactCard;
    const draft = contactCardToEditDraft(cardWithAddress);
    expect(draft.addresses[0]).toMatchObject({
      id: "addr-1",
      street: "123 Main St",
      locality: "Springfield",
      region: "IL",
      postalCode: "62704",
      country: "USA",
      contextType: "home",
    });
    draft.addresses = [
      {
        id: "addr-1",
        street: "456 Oak Ave",
        locality: "Shelbyville",
        region: "IL",
        postalCode: "62565",
        country: "USA",
        contextType: "home",
      },
    ];
    const patch = editDraftToPatch(draft, cardWithAddress);
    expect(patch.addresses).toEqual({
      "addr-1": {
        components: [
          { kind: "name", value: "456 Oak Ave" },
          { kind: "locality", value: "Shelbyville" },
          { kind: "region", value: "IL" },
          { kind: "postcode", value: "62565" },
          { kind: "country", value: "USA" },
        ],
        isOrdered: false,
        contexts: { private: true },
      },
    });
  });

  it("maps label-only address full to street in edit draft", () => {
    const cardWithLabelOnlyAddress = {
      ...janeCard,
      addresses: {
        "addr-1": { "@type": "Address" as const, full: "Main Street 123" },
      },
    } as unknown as ContactCard;
    const draft = contactCardToEditDraft(cardWithLabelOnlyAddress);
    expect(draft.addresses[0]?.street).toBe("Main Street 123");
  });

  it("builds structured address components", () => {
    const draft = {
      ...emptyContactEditDraft(),
      addresses: [
        {
          id: "addr-new",
          street: "1 Example St",
          locality: "Amsterdam",
          region: "",
          postalCode: "1011",
          country: "Netherlands",
          contextType: "work" as const,
        },
      ],
    };
    const body = editDraftToCreateBody(draft, { default: true });
    expect(body.addresses).toEqual({
      "addr-new": {
        components: [
          { kind: "name", value: "1 Example St" },
          { kind: "locality", value: "Amsterdam" },
          { kind: "postcode", value: "1011" },
          { kind: "country", value: "Netherlands" },
        ],
        isOrdered: false,
        contexts: { work: true },
      },
    });
  });

  it("detects empty vs non-empty create drafts", () => {
    expect(contactEditDraftHasContent(emptyContactEditDraft())).toBe(false);
    expect(contactEditDraftHasContent({ ...emptyContactEditDraft(), nameSurname: "Only" })).toBe(
      true,
    );
    expect(
      contactEditDraftHasContent({
        ...emptyContactEditDraft(),
        phones: [{ id: "p1", number: "+1-555-0100", phoneType: "" }],
      }),
    ).toBe(true);
  });

  it("builds minimal create body with only surname (no empty name.full)", () => {
    const draft = { ...emptyContactEditDraft(), nameSurname: "Vendrik" };
    const body = editDraftToCreateBody(draft, { default: true });
    expect(body.name).toEqual({
      isOrdered: false,
      components: [{ kind: "surname", value: "Vendrik" }],
      full: "Vendrik",
    });
    expect(body).not.toHaveProperty("phones");
    expect(body).not.toHaveProperty("emails");
  });

  it("omits empty channel rows from create body", () => {
    const draft = {
      ...emptyContactEditDraft(),
      nameSurname: "Vendrik",
      phones: [{ id: "empty-phone", number: "", phoneType: "work" as const }],
      emails: [{ id: "empty-email", address: "  ", contextType: "" as const }],
      urls: [{ id: "empty-url", uri: "", contextType: "home" as const }],
      addresses: [
        {
          id: "empty-addr",
          street: "",
          locality: "",
          region: "",
          postalCode: "",
          country: "",
          contextType: "work" as const,
        },
      ],
    };
    const body = editDraftToCreateBody(draft, { default: true });
    expect(body).not.toHaveProperty("phones");
    expect(body).not.toHaveProperty("emails");
    expect(body).not.toHaveProperty("links");
    expect(body).not.toHaveProperty("addresses");
  });

  it("builds sparse create body with phone only", () => {
    const draft = {
      ...emptyContactEditDraft(),
      phones: [{ id: "phone-only", number: "+31-6-12345678", phoneType: "" as const }],
    };
    const body = editDraftToCreateBody(draft, { default: true });
    expect(body).not.toHaveProperty("name");
    expect(body.phones).toEqual({ "phone-only": { number: "+31-6-12345678" } });
  });

  it("builds sparse create body with note only", () => {
    const draft = { ...emptyContactEditDraft(), notes: "Met at conference" };
    const body = editDraftToCreateBody(draft, { default: true });
    expect(body).not.toHaveProperty("name");
    expect(Object.values(body.notes ?? {})[0]).toEqual({ note: "Met at conference" });
  });
});
