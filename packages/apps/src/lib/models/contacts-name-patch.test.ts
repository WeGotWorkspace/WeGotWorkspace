import { describe, expect, it } from "vitest";
import type { ContactCard } from "@/lib/models/contacts-types";
import { rebaseContactDraft } from "@/contacts-core/src/contacts-draft-rows";
import { contactCardToEditDraft, editDraftToPatch } from "@/lib/models/contacts-edit-draft";

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

const doctor = cardWith({
  name: {
    "@type": "Name",
    isOrdered: false,
    full: "Dr. Jane Q Doe, PhD",
    components: [
      { "@type": "NameComponent", kind: "title", value: "Dr." },
      { "@type": "NameComponent", kind: "given", value: "Jane" },
      { "@type": "NameComponent", kind: "given2", value: "Q" },
      { "@type": "NameComponent", kind: "surname", value: "Doe" },
      { "@type": "NameComponent", kind: "credential", value: "PhD" },
    ],
  },
});

describe("contact name patch", () => {
  it("sends nothing for a name with a title and credential that was not changed", () => {
    expect(editDraftToPatch(contactCardToEditDraft(doctor), doctor)).toEqual({});
  });

  it("keeps the title and credential when the given name changes", () => {
    const draft = { ...contactCardToEditDraft(doctor), nameGiven: "Janet" };
    const name = editDraftToPatch(draft, doctor).name!;
    expect(name.components?.map((part) => `${part.kind}:${part.value}`)).toEqual([
      "title:Dr.",
      "given:Janet",
      "given2:Q",
      "surname:Doe",
      "credential:PhD",
    ]);
    expect(name.full).toBe("Dr. Janet Q Doe, PhD");
  });

  it("puts a new given name ahead of the surname", () => {
    const card = cardWith({
      name: {
        "@type": "Name",
        isOrdered: false,
        components: [{ "@type": "NameComponent", kind: "surname", value: "Doe" }],
      },
    });
    const draft = { ...contactCardToEditDraft(card), nameGiven: "Jane" };
    expect(editDraftToPatch(draft, card).name?.components?.map((part) => part.kind)).toEqual([
      "given",
      "surname",
    ]);
  });
});

describe("contact channel patch", () => {
  it("leaves an address the draft cannot read alone", () => {
    // An address in a shape the editor does not read comes in as an empty row.
    const card = cardWith({
      name: { "@type": "Name", isOrdered: false, full: "Jane Doe" },
      addresses: { a1: { "@type": "Address", street: "123 Main St" } },
    });
    const draft = { ...contactCardToEditDraft(card), nameGiven: "Janet" };
    expect(Object.keys(editDraftToPatch(draft, card))).toEqual(["name"]);
  });
});

describe("rebaseContactDraft", () => {
  const card = cardWith({
    name: { "@type": "Name", isOrdered: false, full: "Jane Doe" },
    notes: { n1: { "@type": "Note", note: "Old note" } },
  });
  const synced = contactCardToEditDraft(card);

  it("takes another device's change in a field the person did not touch", () => {
    const fresh = { ...synced, notes: "New note" };
    const draft = { ...synced, nameGiven: "Janet" };
    const next = rebaseContactDraft(draft, synced, fresh);
    expect(next.notes).toBe("New note");
    expect(next.nameGiven).toBe("Janet");
  });

  it("keeps the person's own edit of a field another device also changed", () => {
    const fresh = { ...synced, notes: "Their note" };
    const draft = { ...synced, notes: "My note" };
    expect(rebaseContactDraft(draft, synced, fresh).notes).toBe("My note");
  });

  it("keeps a row just added and not filled in yet", () => {
    const blank = { id: "p-new", number: "", phoneType: "mobile" as const };
    const syncedWithBlank = { ...synced, phones: [blank] };
    const fresh = { ...synced, notes: "New note" };
    const next = rebaseContactDraft(syncedWithBlank, syncedWithBlank, fresh);
    expect(next.phones).toEqual([blank]);
  });
});
