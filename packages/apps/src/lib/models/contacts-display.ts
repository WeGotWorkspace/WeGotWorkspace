/** Contact names, sorted channel maps and birthday/anniversary lookup: shared by Contacts and lib. */
import type { ContactCard } from "@/lib/models/contacts-types";

export function mapEntriesSorted<T>(map: Record<string, T> | undefined): [string, T][] {
  if (!map) return [];
  return Object.entries(map).sort(([left], [right]) => left.localeCompare(right));
}

function firstMapValue<T>(map: Record<string, T> | undefined): T | undefined {
  const [entry] = mapEntriesSorted(map);
  return entry?.[1];
}

export type NameComponentLike = { kind: string; value: string };

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

export function firstOrganizationName(card: ContactCard): string | undefined {
  const organization = firstMapValue(card.organizations);
  const name = organization?.name?.trim();
  if (name) return name;
  return organization?.units?.[0]?.name?.trim() || undefined;
}

export type ContactAnniversary = NonNullable<NonNullable<ContactCard["anniversaries"]>[string]>;

export function isContactAnniversary(
  value: ContactAnniversary | null | undefined,
): value is ContactAnniversary {
  return value != null && typeof value === "object" && typeof value.kind === "string";
}

/** First JSContact `anniversaries` entry with `kind: "birth"`, skipping null/cleared slots. */
export function findBirthAnniversary(card: ContactCard): [string, ContactAnniversary] | undefined {
  return mapEntriesSorted(card.anniversaries).find(
    (entry): entry is [string, ContactAnniversary] =>
      isContactAnniversary(entry[1]) && entry[1].kind === "birth",
  );
}
