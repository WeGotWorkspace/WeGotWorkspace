import { describe, expect, it } from "vitest";
import type { ContactCard, ContactCardPatch } from "@/lib/models/contacts-types";
import {
  applyContactPatch,
  coalesceContactPatches,
} from "@/lib/offline/contacts/contacts-patch-merge";

function cardWith(extra: Record<string, unknown>): ContactCard {
  return {
    id: "card-1",
    "@type": "Card",
    version: "1.0",
    uid: "urn:uuid:card-1",
    addressBookIds: { default: true },
    ...extra,
  } as unknown as ContactCard;
}

describe("applyContactPatch (optimistic cache view)", () => {
  it("retains addresses when a non-address field is edited (#210)", () => {
    const card = cardWith({
      name: { "@type": "Name", isOrdered: false, full: "Jane Doe" },
      addresses: {
        a1: { "@type": "Address", components: [{ kind: "locality", value: "Paris" }] },
      },
    });

    const merged = applyContactPatch(card, {
      name: { "@type": "Name", isOrdered: false, full: "Jane Roe" },
    } as ContactCardPatch);

    expect(merged.name?.full).toBe("Jane Roe");
    expect(merged.addresses?.a1).toEqual({
      "@type": "Address",
      components: [{ kind: "locality", value: "Paris" }],
    });
  });

  it("retains existing members when patching members on a group (#210)", () => {
    const card = cardWith({
      kind: "group",
      members: { "urn:uuid:m1": true },
    });

    const merged = applyContactPatch(card, {
      members: { "urn:uuid:m2": true },
    } as ContactCardPatch);

    expect(merged.members).toEqual({ "urn:uuid:m1": true, "urn:uuid:m2": true });
  });

  it("preserves sibling entries for links, organizations and notes", () => {
    const card = cardWith({
      links: { l1: { "@type": "Link", uri: "https://a.example" } },
      organizations: { o1: { "@type": "Organization", name: "Acme" } },
      notes: { n1: { "@type": "Note", note: "first" } },
    });

    const merged = applyContactPatch(card, {
      links: { l2: { "@type": "Link", uri: "https://b.example" } },
      organizations: { o2: { "@type": "Organization", name: "Globex" } },
      notes: { n2: { "@type": "Note", note: "second" } },
    } as ContactCardPatch);

    expect(Object.keys(merged.links ?? {})).toEqual(["l1", "l2"]);
    expect(Object.keys(merged.organizations ?? {})).toEqual(["o1", "o2"]);
    expect(Object.keys(merged.notes ?? {})).toEqual(["n1", "n2"]);
  });

  it("removes a map entry when its patch value is null but keeps siblings", () => {
    const card = cardWith({
      emails: {
        id1: { "@type": "EmailAddress", address: "a@example.com" },
        id2: { "@type": "EmailAddress", address: "b@example.com" },
      },
    });

    const merged = applyContactPatch(card, {
      emails: { id1: null },
    } as unknown as ContactCardPatch);

    expect(merged.emails?.id1).toBeUndefined();
    expect(merged.emails?.id2?.address).toBe("b@example.com");
  });

  it("replaces arrays wholesale (name.components) while keeping sibling object keys", () => {
    const card = cardWith({
      name: {
        "@type": "Name",
        isOrdered: false,
        full: "Jane Doe",
        components: [
          { kind: "given", value: "Jane" },
          { kind: "surname", value: "Doe" },
        ],
      },
    });

    const merged = applyContactPatch(card, {
      name: { components: [{ kind: "given", value: "Janet" }] },
    } as unknown as ContactCardPatch);

    expect(merged.name?.components).toEqual([{ kind: "given", value: "Janet" }]);
    // sibling scalar key on the nested object survives the partial patch
    expect(merged.name?.full).toBe("Jane Doe");
  });

  it("deep-merges a map entry's nested object (matches server entry merge)", () => {
    const card = cardWith({
      emails: {
        id1: { "@type": "EmailAddress", address: "a@example.com", contexts: { work: true } },
      },
    });

    const merged = applyContactPatch(card, {
      emails: { id1: { address: "new@example.com" } },
    } as unknown as ContactCardPatch);

    expect(merged.emails?.id1).toEqual({
      "@type": "EmailAddress",
      address: "new@example.com",
      contexts: { work: true },
    });
  });
});

describe("coalesceContactPatches (outbox payload)", () => {
  it("combines edits to different fields and ids into one patch", () => {
    const a: ContactCardPatch = {
      name: { "@type": "Name", isOrdered: false, full: "Jane A" },
      emails: { e1: { "@type": "EmailAddress", address: "a@example.com" } },
    } as ContactCardPatch;
    const b: ContactCardPatch = {
      phones: { p1: { "@type": "Phone", number: "123" } },
      emails: { e2: { "@type": "EmailAddress", address: "b@example.com" } },
    } as ContactCardPatch;

    const merged = coalesceContactPatches(a, b);

    expect(merged.name?.full).toBe("Jane A");
    expect(Object.keys(merged.emails ?? {})).toEqual(["e1", "e2"]);
    expect(merged.phones?.p1?.number).toBe("123");
  });

  it("keeps a null delete from the later patch in the coalesced payload", () => {
    const a: ContactCardPatch = {
      emails: { e1: { "@type": "EmailAddress", address: "a@example.com" } },
    } as ContactCardPatch;
    const b = { emails: { e1: null } } as unknown as ContactCardPatch;

    const merged = coalesceContactPatches(a, b);

    expect(merged.emails).toEqual({ e1: null });
  });

  it("lets a later add override an earlier delete of the same id", () => {
    const a = { emails: { e1: null } } as unknown as ContactCardPatch;
    const b: ContactCardPatch = {
      emails: { e1: { "@type": "EmailAddress", address: "re-added@example.com" } },
    } as ContactCardPatch;

    const merged = coalesceContactPatches(a, b);

    expect(merged.emails?.e1).toEqual({
      "@type": "EmailAddress",
      address: "re-added@example.com",
    });
  });

  it("coalescing then applying equals applying the patches sequentially", () => {
    const card = cardWith({
      emails: { e0: { "@type": "EmailAddress", address: "keep@example.com" } },
    });
    const a = {
      emails: { e1: { "@type": "EmailAddress", address: "a@example.com" } },
    } as unknown as ContactCardPatch;
    const b = {
      emails: { e0: null, e1: { address: "a2@example.com" } },
    } as unknown as ContactCardPatch;

    const sequential = applyContactPatch(applyContactPatch(card, a), b);
    const coalesced = applyContactPatch(card, coalesceContactPatches(a, b));

    expect(coalesced).toEqual(sequential);
    expect(coalesced.emails?.e0).toBeUndefined();
    expect(coalesced.emails?.e1?.address).toBe("a2@example.com");
  });
});
