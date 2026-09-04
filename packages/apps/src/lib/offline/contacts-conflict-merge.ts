import {
  contactCardToEditDraft,
  editDraftToPatch,
  type ContactEditDraft,
  type ContactPhoneType,
} from "@/contacts-core/src/contacts-edit-utils";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";
import type { ContactCard, ContactCardPatch } from "@/contacts-core/src/contacts-types";

/** Editable contact sections surfaced in the field-level conflict merge UI. */
export type ContactConflictFieldKey =
  | "name"
  | "kind"
  | "title"
  | "organization"
  | "notes"
  | "phones"
  | "emails"
  | "addresses"
  | "urls";

export type ContactConflictFieldChoice = "local" | "server";

export type ContactConflictFieldChoices = Record<
  ContactConflictFieldKey,
  ContactConflictFieldChoice
>;

export type ContactConflictFieldRow = {
  key: ContactConflictFieldKey;
  label: string;
  localValue: string;
  serverValue: string;
};

const EMPTY_PLACEHOLDER = "—";

function channelLabel(
  contextType: ContactEditDraft["emails"][number]["contextType"],
  L: ContactsUILabels,
): string {
  if (contextType === "work") return L.channelTypeWork;
  if (contextType === "home") return L.channelTypeHome;
  if (contextType === "school") return L.channelTypeSchool;
  return L.channelTypeNone;
}

function phoneTypeLabel(phoneType: ContactPhoneType, L: ContactsUILabels): string {
  if (phoneType === "mobile") return L.channelTypeMobile;
  return channelLabel(phoneType, L);
}

function formatNameDraft(draft: ContactEditDraft): string {
  const parts = [draft.nameGiven, draft.nameGiven2, draft.nameSurname]
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.join(" ") || EMPTY_PLACEHOLDER;
}

function formatKindDraft(draft: ContactEditDraft, L: ContactsUILabels): string {
  return draft.showAsCompany ? L.companyContact : "Individual";
}

function formatKindCard(card: ContactCard, L: ContactsUILabels): string {
  if (card.kind === "org") return L.companyContact;
  if (card.kind === "group") return "Group";
  return "Individual";
}

function formatChannelRows(
  rows: Array<{ value: string; typeLabel: string }>,
  L: ContactsUILabels,
): string {
  const lines = rows
    .filter((row) => row.value.trim())
    .map((row) => {
      const value = row.value.trim();
      const type = row.typeLabel;
      return type === L.channelTypeNone ? value : `${value} (${type})`;
    });
  return lines.length > 0 ? lines.join("\n") : EMPTY_PLACEHOLDER;
}

function formatPhoneDraft(draft: ContactEditDraft, L: ContactsUILabels): string {
  return formatChannelRows(
    draft.phones.map((row) => ({
      value: row.number,
      typeLabel: phoneTypeLabel(row.phoneType, L),
    })),
    L,
  );
}

function formatEmailDraft(draft: ContactEditDraft, L: ContactsUILabels): string {
  return formatChannelRows(
    draft.emails.map((row) => ({
      value: row.address,
      typeLabel: channelLabel(row.contextType, L),
    })),
    L,
  );
}

function formatUrlDraft(draft: ContactEditDraft, L: ContactsUILabels): string {
  return formatChannelRows(
    draft.urls.map((row) => ({
      value: row.uri,
      typeLabel: channelLabel(row.contextType, L),
    })),
    L,
  );
}

function formatAddressDraft(draft: ContactEditDraft, L: ContactsUILabels): string {
  const lines = draft.addresses
    .filter((row) =>
      [row.street, row.locality, row.region, row.postalCode, row.country].some((part) =>
        part.trim(),
      ),
    )
    .map((row) => {
      const parts = [row.street, row.locality, row.region, row.postalCode, row.country]
        .map((part) => part.trim())
        .filter(Boolean);
      const type = channelLabel(row.contextType, L);
      const body = parts.join(", ");
      return type === L.channelTypeNone ? body : `${body} (${type})`;
    });
  return lines.length > 0 ? lines.join("\n") : EMPTY_PLACEHOLDER;
}

function formatScalar(value: string): string {
  const trimmed = value.trim();
  return trimmed || EMPTY_PLACEHOLDER;
}

function formatOrganizationDraft(draft: ContactEditDraft): string {
  const orgParts = [draft.department, draft.organization]
    .map((part) => part.trim())
    .filter(Boolean);
  return orgParts.length > 0 ? orgParts.join(" · ") : EMPTY_PLACEHOLDER;
}

function nameDraftSignature(draft: ContactEditDraft): string {
  return JSON.stringify({
    given: draft.nameGiven.trim(),
    given2: draft.nameGiven2.trim(),
    surname: draft.nameSurname.trim(),
    showGiven2: draft.showGiven2,
  });
}

function kindDraftSignature(draft: ContactEditDraft): string {
  return draft.showAsCompany ? "org" : "individual";
}

function kindCardSignature(card: ContactCard): string {
  if (card.kind === "group") return "group";
  return card.kind === "org" ? "org" : "individual";
}

function channelRowsSignature(
  rows: Array<{
    id: string;
    value: string;
    type: string;
  }>,
): string {
  return JSON.stringify(
    rows
      .map((row) => ({ id: row.id, value: row.value.trim(), type: row.type }))
      .filter((row) => row.value)
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}

function addressRowsSignature(draft: ContactEditDraft): string {
  return JSON.stringify(
    draft.addresses
      .map((row) => ({
        id: row.id,
        street: row.street.trim(),
        locality: row.locality.trim(),
        region: row.region.trim(),
        postalCode: row.postalCode.trim(),
        country: row.country.trim(),
        contextType: row.contextType,
      }))
      .filter((row) => row.street || row.locality || row.region || row.postalCode || row.country)
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}

function fieldDiffers(
  key: ContactConflictFieldKey,
  localDraft: ContactEditDraft,
  serverDraft: ContactEditDraft,
  serverCard: ContactCard,
): boolean {
  switch (key) {
    case "name":
      return nameDraftSignature(localDraft) !== nameDraftSignature(serverDraft);
    case "kind":
      return kindDraftSignature(localDraft) !== kindCardSignature(serverCard);
    case "title":
      return localDraft.title.trim() !== serverDraft.title.trim();
    case "organization":
      return (
        localDraft.organization.trim() !== serverDraft.organization.trim() ||
        localDraft.department.trim() !== serverDraft.department.trim()
      );
    case "notes":
      return localDraft.notes.trim() !== serverDraft.notes.trim();
    case "phones":
      return (
        channelRowsSignature(
          localDraft.phones.map((row) => ({
            id: row.id,
            value: row.number,
            type: row.phoneType,
          })),
        ) !==
        channelRowsSignature(
          serverDraft.phones.map((row) => ({
            id: row.id,
            value: row.number,
            type: row.phoneType,
          })),
        )
      );
    case "emails":
      return (
        channelRowsSignature(
          localDraft.emails.map((row) => ({
            id: row.id,
            value: row.address,
            type: row.contextType,
          })),
        ) !==
        channelRowsSignature(
          serverDraft.emails.map((row) => ({
            id: row.id,
            value: row.address,
            type: row.contextType,
          })),
        )
      );
    case "urls":
      return (
        channelRowsSignature(
          localDraft.urls.map((row) => ({
            id: row.id,
            value: row.uri,
            type: row.contextType,
          })),
        ) !==
        channelRowsSignature(
          serverDraft.urls.map((row) => ({
            id: row.id,
            value: row.uri,
            type: row.contextType,
          })),
        )
      );
    case "addresses":
      return addressRowsSignature(localDraft) !== addressRowsSignature(serverDraft);
    default:
      return false;
  }
}

const FIELD_ORDER: ContactConflictFieldKey[] = [
  "name",
  "kind",
  "title",
  "organization",
  "notes",
  "phones",
  "emails",
  "addresses",
  "urls",
];

function fieldLabel(key: ContactConflictFieldKey, L: ContactsUILabels): string {
  switch (key) {
    case "name":
      return L.sectionName;
    case "kind":
      return L.companyContact;
    case "title":
      return L.jobTitle;
    case "organization":
      return L.sectionOrganization;
    case "notes":
      return L.sectionNotes;
    case "phones":
      return L.sectionPhones;
    case "emails":
      return L.sectionEmails;
    case "addresses":
      return L.sectionAddresses;
    case "urls":
      return L.sectionUrls;
  }
}

function fieldValues(
  key: ContactConflictFieldKey,
  localDraft: ContactEditDraft,
  serverDraft: ContactEditDraft,
  serverCard: ContactCard,
  L: ContactsUILabels,
): { localValue: string; serverValue: string } {
  switch (key) {
    case "name":
      return { localValue: formatNameDraft(localDraft), serverValue: formatNameDraft(serverDraft) };
    case "kind":
      return {
        localValue: formatKindDraft(localDraft, L),
        serverValue: formatKindCard(serverCard, L),
      };
    case "title":
      return {
        localValue: formatScalar(localDraft.title),
        serverValue: formatScalar(serverDraft.title),
      };
    case "organization":
      return {
        localValue: formatOrganizationDraft(localDraft),
        serverValue: formatOrganizationDraft(serverDraft),
      };
    case "notes":
      return {
        localValue: formatScalar(localDraft.notes),
        serverValue: formatScalar(serverDraft.notes),
      };
    case "phones":
      return {
        localValue: formatPhoneDraft(localDraft, L),
        serverValue: formatPhoneDraft(serverDraft, L),
      };
    case "emails":
      return {
        localValue: formatEmailDraft(localDraft, L),
        serverValue: formatEmailDraft(serverDraft, L),
      };
    case "addresses":
      return {
        localValue: formatAddressDraft(localDraft, L),
        serverValue: formatAddressDraft(serverDraft, L),
      };
    case "urls":
      return {
        localValue: formatUrlDraft(localDraft, L),
        serverValue: formatUrlDraft(serverDraft, L),
      };
  }
}

/**
 * Build per-field diff rows for the conflict UI. Only fields that differ between
 * the optimistic local card and the fresh server card are included.
 */
export function buildContactConflictFieldRows(
  serverCard: ContactCard,
  localCard: ContactCard,
  labels: ContactsUILabels,
): ContactConflictFieldRow[] {
  const localDraft = contactCardToEditDraft(localCard);
  const serverDraft = contactCardToEditDraft(serverCard);
  const rows: ContactConflictFieldRow[] = [];

  for (const key of FIELD_ORDER) {
    if (key === "kind" && serverCard.kind === "group") continue;
    if (!fieldDiffers(key, localDraft, serverDraft, serverCard)) continue;
    const values = fieldValues(key, localDraft, serverDraft, serverCard, labels);
    rows.push({ key, label: fieldLabel(key, labels), ...values });
  }

  return rows;
}

/** Default per-field choices: prefer the user's queued (local) edits. */
export function defaultContactConflictFieldChoices(
  rows: ContactConflictFieldRow[],
): ContactConflictFieldChoices {
  const choices = {} as ContactConflictFieldChoices;
  for (const row of rows) {
    choices[row.key] = "local";
  }
  return choices;
}

function pickDraftField<K extends keyof ContactEditDraft>(
  key: K,
  fieldKey: ContactConflictFieldKey,
  localDraft: ContactEditDraft,
  serverDraft: ContactEditDraft,
  choices: ContactConflictFieldChoices,
): ContactEditDraft[K] {
  const choice = choices[fieldKey] ?? "local";
  return choice === "local" ? localDraft[key] : serverDraft[key];
}

/** Merge per-field choices into a single edit draft (2-way: local vs server). */
export function buildMergedContactEditDraft(
  serverCard: ContactCard,
  localCard: ContactCard,
  choices: ContactConflictFieldChoices,
): ContactEditDraft {
  const localDraft = contactCardToEditDraft(localCard);
  const serverDraft = contactCardToEditDraft(serverCard);

  return {
    nameGiven: pickDraftField("nameGiven", "name", localDraft, serverDraft, choices),
    nameGiven2: pickDraftField("nameGiven2", "name", localDraft, serverDraft, choices),
    nameSurname: pickDraftField("nameSurname", "name", localDraft, serverDraft, choices),
    showGiven2: pickDraftField("showGiven2", "name", localDraft, serverDraft, choices),
    showAsCompany: pickDraftField("showAsCompany", "kind", localDraft, serverDraft, choices),
    phones: pickDraftField("phones", "phones", localDraft, serverDraft, choices),
    emails: pickDraftField("emails", "emails", localDraft, serverDraft, choices),
    addresses: pickDraftField("addresses", "addresses", localDraft, serverDraft, choices),
    urls: pickDraftField("urls", "urls", localDraft, serverDraft, choices),
    title: pickDraftField("title", "title", localDraft, serverDraft, choices),
    titleId: pickDraftField("titleId", "title", localDraft, serverDraft, choices),
    department: pickDraftField("department", "organization", localDraft, serverDraft, choices),
    organization: pickDraftField("organization", "organization", localDraft, serverDraft, choices),
    notes: pickDraftField("notes", "notes", localDraft, serverDraft, choices),
    organizationId: pickDraftField(
      "organizationId",
      "organization",
      localDraft,
      serverDraft,
      choices,
    ),
    notesId: pickDraftField("notesId", "notes", localDraft, serverDraft, choices),
    birthday: localDraft.birthday,
    birthdayId: localDraft.birthdayId,
  };
}

/** Build the patch to push after the user resolves field-level conflicts. */
export function buildResolvedContactPatch(
  serverCard: ContactCard,
  localCard: ContactCard,
  choices: ContactConflictFieldChoices,
): ContactCardPatch {
  const mergedDraft = buildMergedContactEditDraft(serverCard, localCard, choices);
  const patch = editDraftToPatch(mergedDraft, serverCard);

  if (choices.name === "server") delete patch.name;
  if (choices.kind === "server") delete patch.kind;
  if (choices.title === "server") delete patch.titles;
  if (choices.organization === "server") delete patch.organizations;
  if (choices.notes === "server") delete patch.notes;
  if (choices.phones === "server") delete patch.phones;
  if (choices.emails === "server") delete patch.emails;
  if (choices.addresses === "server") delete patch.addresses;
  if (choices.urls === "server") delete patch.links;

  return patch;
}
