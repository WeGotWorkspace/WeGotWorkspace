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

/** A row as "Add phone" and friends leave it: nothing filled in yet. */
const isBlankRow: { [K in RowList]: (row: ContactEditDraft[K][number]) => boolean } = {
  phones: (row) => !row.number.trim(),
  emails: (row) => !row.address.trim(),
  urls: (row) => !row.uri.trim(),
  addresses: (row) =>
    [row.street, row.postalCode, row.locality, row.region, row.country].every(
      (part) => !part.trim(),
    ),
};

const ROW_LISTS = Object.keys(isBlankRow) as RowList[];

type Row = { id: string };
const rowsOf = (draft: ContactEditDraft, list: RowList) => draft[list] as Row[];
const isBlank = (list: RowList) => isBlankRow[list] as (row: Row) => boolean;

/**
 * `next` with what `prev` shows that no card holds: rows just added and not filled in
 * ("Add phone"), and a revealed middle name field. A save or a merge keeps them.
 */
export function withBlankRowsFrom(
  next: ContactEditDraft,
  prev: ContactEditDraft,
): ContactEditDraft {
  const merged: Record<string, unknown> = {
    ...next,
    showGiven2: next.showGiven2 || prev.showGiven2,
  };
  for (const list of ROW_LISTS) {
    const rows = rowsOf(next, list);
    const blank = rowsOf(prev, list).filter(
      (row) => isBlank(list)(row) && !rows.some((saved) => saved.id === row.id),
    );
    merged[list] = [...rows, ...blank];
  }
  return merged as ContactEditDraft;
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

/** Shown or hidden only: never a change to the card. */
const DISPLAY_ONLY = new Set<keyof ContactEditDraft>(["showGiven2"]);

/** What a field holds for the card: empty rows and display flags left out. */
function cardValue(draft: ContactEditDraft, key: keyof ContactEditDraft) {
  if (DISPLAY_ONLY.has(key)) return undefined;
  if ((ROW_LISTS as string[]).includes(key)) {
    const list = key as RowList;
    return rowsOf(draft, list).filter((row) => !isBlank(list)(row));
  }
  return draft[key];
}

const groupTouched = (
  group: (keyof ContactEditDraft)[],
  draft: ContactEditDraft,
  synced: ContactEditDraft,
) =>
  group.some(
    (key) => JSON.stringify(cardValue(draft, key)) !== JSON.stringify(cardValue(synced, key)),
  );

/**
 * The open draft on top of a card another device changed. Each field the person did
 * not touch since `synced` (the draft the card last matched) takes the fresh card's
 * value; a field they did touch keeps theirs, so their next save sends only that. An
 * empty row or a revealed field is not a touch: it stays, beside the fresh values.
 * With no touched field the result is `withBlankRowsFrom(fresh, draft)`, which is
 * what the merge marks as synced, so nothing is saved.
 */
export function rebaseContactDraft(
  draft: ContactEditDraft,
  synced: ContactEditDraft | ContactEditDraft[],
  fresh: ContactEditDraft,
): ContactEditDraft {
  const bases = Array.isArray(synced) ? synced : [synced];
  const next: Record<string, unknown> = { ...withBlankRowsFrom(fresh, draft) };
  for (const group of DRAFT_FIELD_GROUPS) {
    if (!bases.some((base) => groupTouched(group, draft, base))) continue;
    for (const key of group) next[key] = draft[key];
  }
  return next as ContactEditDraft;
}
