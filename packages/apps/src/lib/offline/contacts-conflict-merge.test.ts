import { describe, expect, it } from "vitest";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";
import {
  buildContactConflictFieldRows,
  buildMergedContactEditDraft,
  buildResolvedContactPatch,
  defaultContactConflictFieldChoices,
} from "@/lib/offline/contacts-conflict-merge";

const baseCard = {
  id: "jane-doe",
  "@type": "Card",
  version: "1.0",
  uid: "urn:uuid:jane",
  addressBookIds: { default: true },
  name: { "@type": "Name", isOrdered: false, full: "Jane Doe" },
  state: "state-server",
  kind: "individual",
  emails: {
    e1: { address: "jane@server.example", contexts: { work: true } },
  },
  phones: {
    p1: { number: "+1 555 0100" },
  },
} as unknown as ContactCard;

const localCard = {
  ...baseCard,
  state: "state-local",
  name: { "@type": "Name", isOrdered: false, full: "Jane Local" },
  emails: {
    e1: { address: "jane@local.example", contexts: { work: true } },
  },
  phones: {
    p1: { number: "+1 555 0199" },
  },
} as unknown as ContactCard;

describe("contacts-conflict-merge", () => {
  it("lists only fields that differ between local and server cards", () => {
    const rows = buildContactConflictFieldRows(baseCard, localCard, defaultContactsLabels);
    expect(rows.map((row) => row.key)).toEqual(["name", "phones", "emails"]);
    expect(rows[0]?.localValue).toBe("Jane Local");
    expect(rows[0]?.serverValue).toBe("Jane Doe");
  });

  it("defaults choices to local for each conflicting field", () => {
    const rows = buildContactConflictFieldRows(baseCard, localCard, defaultContactsLabels);
    expect(defaultContactConflictFieldChoices(rows)).toEqual({
      name: "local",
      phones: "local",
      emails: "local",
    });
  });

  it("builds a merged patch from per-field choices", () => {
    const rows = buildContactConflictFieldRows(baseCard, localCard, defaultContactsLabels);
    const choices = defaultContactConflictFieldChoices(rows);
    choices.name = "server";
    choices.emails = "local";

    const mergedDraft = buildMergedContactEditDraft(baseCard, localCard, choices);
    expect(mergedDraft.nameGiven).toBe("Jane");
    expect(mergedDraft.nameSurname).toBe("Doe");
    expect(mergedDraft.emails[0]?.address).toBe("jane@local.example");
    expect(mergedDraft.phones[0]?.number).toBe("+1 555 0199");

    const patch = buildResolvedContactPatch(baseCard, localCard, choices);
    expect(patch.name).toBeUndefined();
    expect(patch.emails?.e1).toEqual({
      address: "jane@local.example",
      contexts: { work: true },
    });
    expect(patch.phones?.p1).toEqual({
      number: "+1 555 0199",
      contexts: null,
      features: null,
    });
  });

  it("returns no rows when local and server drafts match", () => {
    const rows = buildContactConflictFieldRows(baseCard, baseCard, defaultContactsLabels);
    expect(rows).toEqual([]);
  });
});
