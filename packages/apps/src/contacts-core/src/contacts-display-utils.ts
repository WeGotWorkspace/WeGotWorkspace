import type { ContactCard } from "@/contacts-core/src/contacts-types";
import {
  readContactContext,
  type ContactChannelContext,
} from "@/contacts-core/src/contacts-edit-utils";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";

function channelTypeLabel(contextType: ContactChannelContext, labels: ContactsUILabels): string {
  if (contextType === "work") return labels.channelTypeWork;
  if (contextType === "home") return labels.channelTypeHome;
  if (contextType === "school") return labels.channelTypeSchool;
  return labels.channelTypeNone;
}

const PHONE_FEATURE_KEYS = [
  "mobile",
  "fax",
  "main-number",
  "pager",
  "text",
  "textphone",
  "video",
  "voice",
] as const;

const ALLOWED_EXTERNAL_CONTACT_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

type PhoneFeatureKey = (typeof PHONE_FEATURE_KEYS)[number];

/** Human-readable labels for JSContact `Phone.features` (mobile → UI “Mobile”, vCard CELL). */
function phoneFeatureDisplayLabel(featureKey: PhoneFeatureKey, labels: ContactsUILabels): string {
  if (featureKey === "mobile") return labels.channelTypeMobile;
  return featureKey;
}

function collectPhoneFeatureLabels(
  features?: Record<string, boolean | undefined>,
  contexts?: Record<string, boolean | undefined>,
): PhoneFeatureKey[] {
  const active = new Set<PhoneFeatureKey>();
  for (const source of [features, contexts]) {
    if (!source) continue;
    for (const key of PHONE_FEATURE_KEYS) {
      if (source[key]) active.add(key);
    }
  }
  return PHONE_FEATURE_KEYS.filter((key) => active.has(key));
}

function splitCommaSeparatedLabel(label: string): string[] {
  return label
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeCustomLabelToken(token: string, labels: ContactsUILabels): string {
  const key = token.toLowerCase();
  if (key === "home") return labels.channelTypeHome;
  if (key === "work") return labels.channelTypeWork;
  if (key === "school") return labels.channelTypeSchool;
  if (key === "cell" || key === "mobile") return labels.channelTypeMobile;
  if ((PHONE_FEATURE_KEYS as readonly string[]).includes(key)) {
    return phoneFeatureDisplayLabel(key as PhoneFeatureKey, labels);
  }
  return token.trim();
}

function customLabelsFromString(
  customLabel: string,
  labels: ContactsUILabels,
  existing: Set<string>,
): string[] {
  return splitCommaSeparatedLabel(customLabel)
    .map((part) => normalizeCustomLabelToken(part, labels))
    .filter((label) => !existing.has(label));
}

export type ChannelDisplayLabelOptions = {
  features?: Record<string, boolean | undefined>;
  customLabel?: string;
};

/**
 * Read-mode labels for phones, emails, addresses, and links.
 * Phones may emit multiple tags (feature + context); other channels emit at most one context/custom tag.
 */
export function channelDisplayLabels(
  contexts: Record<string, boolean | undefined> | undefined,
  labels: ContactsUILabels,
  options?: ChannelDisplayLabelOptions,
): string[] {
  const featureLabels = collectPhoneFeatureLabels(options?.features, contexts).map((key) =>
    phoneFeatureDisplayLabel(key, labels),
  );

  const contextType = readContactContext(contexts);
  const contextLabel = contextType !== "" ? channelTypeLabel(contextType, labels) : undefined;

  const trimmedCustom = options?.customLabel?.trim();
  const existingLabels = new Set([...featureLabels, ...(contextLabel ? [contextLabel] : [])]);
  const customLabels = trimmedCustom
    ? customLabelsFromString(trimmedCustom, labels, existingLabels)
    : [];

  const resolved = [...featureLabels, ...(contextLabel ? [contextLabel] : []), ...customLabels];

  if (resolved.length === 1 && resolved[0] === "voice") {
    return [];
  }

  return resolved;
}

export function mapEntriesSorted<T>(map: Record<string, T> | undefined): [string, T][] {
  if (!map) return [];
  return Object.entries(map).sort(([left], [right]) => left.localeCompare(right));
}

function firstMapValue<T>(map: Record<string, T> | undefined): T | undefined {
  const [entry] = mapEntriesSorted(map);
  return entry?.[1];
}

type NameComponentLike = { kind: string; value: string };

/** Derive display / `name.full` from JSContact name components (given before surname). */
export function synthesizeNameFromComponents(components: NameComponentLike[] | undefined): string {
  if (!components?.length) return "";

  const given = components
    .filter((component) => component.kind === "given" || component.kind === "given2")
    .map((component) => component.value.trim())
    .filter(Boolean);
  const surname = components
    .filter((component) => component.kind === "surname" || component.kind === "surname2")
    .map((component) => component.value.trim())
    .filter(Boolean);
  const synthesized = [...given, ...surname].join(" ").trim();
  if (synthesized) return synthesized;

  return components
    .map((component) => component.value.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

function nameFromComponents(card: ContactCard): string {
  return synthesizeNameFromComponents(card.name?.components);
}

function nameComponentValue(
  components: NameComponentLike[] | undefined,
  kind: "given" | "given2" | "surname" | "surname2",
): string {
  return (components ?? [])
    .filter((component) => component.kind === kind)
    .map((component) => component.value.trim())
    .filter(Boolean)
    .join(" ");
}

/** Last token as surname when only `name.full` is available (matches edit draft parsing). */
function splitFullNameForSort(fullName: string): { given: string; surname: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return {
      given: parts.slice(0, -1).join(" "),
      surname: parts[parts.length - 1] ?? "",
    };
  }
  return { given: fullName.trim(), surname: "" };
}

function personSortNameParts(card: ContactCard): { given: string; surname: string } {
  const components = card.name?.components;
  let given = [nameComponentValue(components, "given"), nameComponentValue(components, "given2")]
    .filter(Boolean)
    .join(" ");
  let surname = [
    nameComponentValue(components, "surname"),
    nameComponentValue(components, "surname2"),
  ]
    .filter(Boolean)
    .join(" ");

  const fullName = card.name?.full?.trim() ?? "";
  if (!given && !surname && fullName) {
    const split = splitFullNameForSort(fullName);
    given = split.given;
    surname = split.surname;
  }

  return { given, surname };
}

function formatPersonListSortName(given: string, surname: string): string {
  const givenTrimmed = given.trim();
  const surnameTrimmed = surname.trim();
  if (surnameTrimmed && givenTrimmed) return `${surnameTrimmed}, ${givenTrimmed}`;
  if (surnameTrimmed) return surnameTrimmed;
  if (givenTrimmed) return givenTrimmed;
  return "";
}

/** Person name from `name.full` or name components — not organization. */
export function contactPersonName(card: ContactCard): string {
  const full = card.name?.full?.trim();
  if (full) return full;
  return nameFromComponents(card);
}

export function contactDisplayName(card: ContactCard): string {
  const organizationName = firstOrganizationName(card);
  const personName = contactPersonName(card);

  if (card.kind === "org") {
    if (organizationName) return organizationName;
    if (personName) return personName;
    return "Unknown contact";
  }

  if (card.kind === "group") {
    if (personName) return personName;
    if (organizationName) return organizationName;
    return "Unknown contact";
  }

  if (personName) return personName;
  if (organizationName) return organizationName;

  return "Unknown contact";
}

function firstOrganizationName(card: ContactCard): string | undefined {
  const organization = firstMapValue(card.organizations);
  const name = organization?.name?.trim();
  if (name) return name;
  return organization?.units?.[0]?.name?.trim() || undefined;
}
export function contactListSubtitle(card: ContactCard): string {
  const organizationName = firstOrganizationName(card);
  const personName = contactPersonName(card);
  const displayName = contactDisplayName(card);

  if (card.kind === "org") {
    if (personName && personName !== displayName) {
      return personName;
    }
    return "";
  }

  if (card.kind === "group") {
    if (organizationName && organizationName !== displayName) {
      return organizationName;
    }
    return "";
  }

  if (organizationName && organizationName !== displayName) {
    return organizationName;
  }

  return "";
}

/** Secondary list line — always empty; email/phone are not shown in the list view. */
export function contactListDetail(_card: ContactCard): string {
  return "";
}

export function contactInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Default REST path for contact media blobs (RFC 9610); appended with blobId. */
export const CONTACT_MEDIA_BLOB_PATH = "/api/v1/contacts/blobs";

type ContactPhotoUrlOptions = {
  /** Base path for blob download URLs; defaults to {@link CONTACT_MEDIA_BLOB_PATH}. */
  blobBaseUrl?: string;
};

/** Blob id for the preferred photo/logo media entry, if any. */
export function contactPhotoBlobId(card: ContactCard): string | undefined {
  const media = card.media;
  if (!media) return undefined;

  const preferredKinds =
    card.kind === "org" ? (["logo", "photo"] as const) : (["photo", "logo"] as const);

  for (const kind of preferredKinds) {
    for (const [, entry] of mapEntriesSorted(media)) {
      if (entry.kind !== kind) continue;
      const blobId = typeof entry.blobId === "string" ? entry.blobId.trim() : "";
      if (blobId) return blobId;
    }
  }

  return undefined;
}

function resolveMediaEntryUrl(
  entry: NonNullable<ContactCard["media"]>[string],
  blobBaseUrl: string,
): string | undefined {
  const uri = typeof entry.uri === "string" ? entry.uri.trim() : "";
  if (uri.startsWith("http://") || uri.startsWith("https://") || uri.startsWith("data:")) {
    return uri;
  }

  const blobId = typeof entry.blobId === "string" ? entry.blobId.trim() : "";
  if (blobId) {
    return `${blobBaseUrl.replace(/\/$/, "")}/${blobId}`;
  }

  return undefined;
}

/**
 * Photo URL from JSContact `media` (RFC 9553). CardDAV PHOTO/LOGO is mapped server-side
 * into `media` entries; inline vCard binary becomes `uri` (data:) or `blobId` on GET.
 */
export function contactPhotoUrl(
  card: ContactCard,
  options?: ContactPhotoUrlOptions,
): string | undefined {
  const media = card.media;
  if (!media) return undefined;

  const blobBaseUrl = options?.blobBaseUrl ?? CONTACT_MEDIA_BLOB_PATH;
  const preferredKinds =
    card.kind === "org" ? (["logo", "photo"] as const) : (["photo", "logo"] as const);

  for (const kind of preferredKinds) {
    for (const [, entry] of mapEntriesSorted(media)) {
      if (entry.kind !== kind) continue;
      const url = resolveMediaEntryUrl(entry, blobBaseUrl);
      if (url) return url;
    }
  }

  return undefined;
}

function formatAnniversaryDate(
  date: NonNullable<NonNullable<ContactCard["anniversaries"]>[string]>["date"],
  locale: string | undefined,
): string {
  if (date["@type"] === "Timestamp") {
    const d = new Date(date.utc);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
  }
  const { year, month, day } = date;
  if (month !== undefined && day !== undefined && year !== undefined) {
    return new Date(year, month - 1, day).toLocaleDateString(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
  if (month !== undefined && day !== undefined) {
    return new Date(2000, month - 1, day).toLocaleDateString(locale, {
      month: "long",
      day: "numeric",
    });
  }
  if (year !== undefined) return String(year);
  return "";
}

/** Birthday string from the card's first `birth` anniversary, or empty string when not set. */
export function contactBirthdayDisplay(card: ContactCard, locale?: string): string {
  const entries = mapEntriesSorted(card.anniversaries);
  const birth = entries.find(([, ann]) => ann.kind === "birth")?.[1];
  if (!birth) return "";
  return formatAnniversaryDate(birth.date, locale);
}

function collectEmails(card: ContactCard): string[] {
  return mapEntriesSorted(card.emails)
    .map(([, email]) => email.address?.trim())
    .filter((value): value is string => Boolean(value));
}

function collectPhones(card: ContactCard): string[] {
  return mapEntriesSorted(card.phones)
    .map(([, phone]) => (typeof phone.number === "string" ? phone.number.trim() : ""))
    .filter(Boolean);
}

/**
 * Produces a `tel:` href from a raw phone number string.
 * Strips whitespace; keeps +, digits, dashes, parentheses and other
 * characters that are valid tel-URI visual-separators (RFC 3966).
 * Returns an empty string when the number is blank.
 */
export function phoneToTelHref(number: string): string {
  const stripped = number.replace(/\s/g, "");
  return stripped ? `tel:${stripped}` : "";
}

/** Sort key for contact lists: surname-first for people, display name for orgs/groups. */
export function contactListSortName(card: ContactCard): string {
  const organizationName = firstOrganizationName(card);
  const { given, surname } = personSortNameParts(card);
  const personSortName = formatPersonListSortName(given, surname);
  const displayName = contactDisplayName(card);

  if (card.kind === "org") {
    if (organizationName) return organizationName.trim();
    if (personSortName) return personSortName;
    return displayName.trim();
  }

  if (card.kind === "group") {
    const groupName = contactPersonName(card).trim() || organizationName?.trim() || "";
    if (groupName) return groupName;
    return displayName.trim();
  }

  if (personSortName) return personSortName;
  if (organizationName) return organizationName.trim();
  return displayName.trim();
}

/** First letter bucket for alphabetical list sections (A–Z or #). */
export function contactListSectionLetter(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "#";

  const first = trimmed.charAt(0).toLocaleUpperCase();
  if (/\p{L}/u.test(first)) return first;
  return "#";
}

export function sortContactCardsForList(cards: ContactCard[]): ContactCard[] {
  return [...cards].sort((left, right) =>
    contactListSortName(left).localeCompare(contactListSortName(right), undefined, {
      sensitivity: "base",
    }),
  );
}

export type ContactListSection = {
  letter: string;
  cards: ContactCard[];
};

export function groupContactCardsBySection(cards: ContactCard[]): ContactListSection[] {
  const sorted = sortContactCardsForList(cards);
  const sections: ContactListSection[] = [];

  for (const card of sorted) {
    const letter = contactListSectionLetter(contactListSortName(card));
    const last = sections[sections.length - 1];
    if (last?.letter === letter) {
      last.cards.push(card);
    } else {
      sections.push({ letter, cards: [card] });
    }
  }

  return sections;
}

/**
 * Returns a safe absolute href for external contact links.
 * Unsupported or malformed protocols (for example `javascript:`) are rejected.
 */
export function safeContactExternalHref(href: string): string {
  const trimmed = href.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    return ALLOWED_EXTERNAL_CONTACT_LINK_PROTOCOLS.has(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

export function filterCardsBySearch(cards: ContactCard[], query: string): ContactCard[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return cards;

  return cards.filter((card) => {
    const haystack = [
      contactDisplayName(card),
      contactListSubtitle(card),
      contactListDetail(card),
      ...collectEmails(card),
      ...collectPhones(card),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}
