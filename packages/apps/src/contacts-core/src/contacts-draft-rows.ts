import { useCallback, type Dispatch, type SetStateAction } from "react";
import {
  CONTACT_CHANNEL_DEFAULT_CONTEXT,
  newContactMapId,
  type ContactEditDraft,
} from "@/contacts-core/src/contacts-edit-utils";

type RowList = "phones" | "emails" | "urls" | "addresses";

/** An empty row of each list, as "Add phone" and friends add it. */
const blankRow: { [K in RowList]: (id: string) => ContactEditDraft[K][number] } = {
  phones: (id) => ({ id, number: "", phoneType: "mobile" }),
  emails: (id) => ({ id, address: "", contextType: CONTACT_CHANNEL_DEFAULT_CONTEXT }),
  urls: (id) => ({ id, uri: "", contextType: CONTACT_CHANNEL_DEFAULT_CONTEXT }),
  addresses: (id) => ({
    id,
    street: "",
    locality: "",
    region: "",
    postalCode: "",
    country: "",
    contextType: CONTACT_CHANNEL_DEFAULT_CONTEXT,
  }),
};

/** "Add phone" and friends: an empty row at the end of the draft's list; returns its id for focus. */
export function useContactDraftRowAdders(
  setEditDraft: Dispatch<SetStateAction<ContactEditDraft | null>>,
) {
  const add = useCallback(
    (list: RowList) => {
      const id = newContactMapId();
      setEditDraft((prev) =>
        prev ? { ...prev, [list]: [...prev[list], blankRow[list](id)] } : prev,
      );
      return id;
    },
    [setEditDraft],
  );
  return {
    addPhone: useCallback(() => add("phones"), [add]),
    addEmail: useCallback(() => add("emails"), [add]),
    addAddress: useCallback(() => add("addresses"), [add]),
    addUrl: useCallback(() => add("urls"), [add]),
  };
}

/**
 * `next` with the rows of `prev` that are still empty (just added with "Add phone"),
 * so a save does not take away a row someone is about to fill in.
 */
export function withBlankRowsFrom(
  next: ContactEditDraft,
  prev: ContactEditDraft,
): ContactEditDraft {
  const keep = <T extends { id: string }>(rows: T[], prevRows: T[], blank: (row: T) => boolean) => [
    ...rows,
    ...prevRows.filter((row) => blank(row) && !rows.some((saved) => saved.id === row.id)),
  ];
  return {
    ...next,
    phones: keep(next.phones, prev.phones, (row) => !row.number.trim()),
    emails: keep(next.emails, prev.emails, (row) => !row.address.trim()),
    urls: keep(next.urls, prev.urls, (row) => !row.uri.trim()),
    addresses: keep(next.addresses, prev.addresses, (row) =>
      [row.street, row.postalCode, row.locality, row.region, row.country].every(
        (part) => !part.trim(),
      ),
    ),
  };
}

/** Draft fields that change together: a merge never mixes a name or a company from two versions. */
const DRAFT_FIELD_GROUPS: (keyof ContactEditDraft)[][] = [
  ["nameGiven", "nameGiven2", "nameSurname", "showGiven2"],
  ["showAsCompany"],
  ["phones"],
  ["emails"],
  ["addresses"],
  ["urls"],
  ["title", "titleId"],
  ["organization", "department", "organizationId"],
  ["notes", "notesId"],
  ["birthday", "birthdayId"],
];

/**
 * The open draft on top of a card another device changed. Each field the person did
 * not touch since `synced` (the draft the card last matched) takes the fresh card's
 * value; a field they did touch keeps theirs, so their next save sends only that.
 */
export function rebaseContactDraft(
  draft: ContactEditDraft,
  synced: ContactEditDraft,
  fresh: ContactEditDraft,
): ContactEditDraft {
  const next: Record<string, unknown> = { ...draft };
  for (const group of DRAFT_FIELD_GROUPS) {
    const touched = group.some((key) => JSON.stringify(draft[key]) !== JSON.stringify(synced[key]));
    if (touched) continue;
    for (const key of group) next[key] = fresh[key];
  }
  return withBlankRowsFrom(next as ContactEditDraft, draft);
}
