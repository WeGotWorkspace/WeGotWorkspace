import type { ContactEditDraft } from "@/lib/models/contacts-edit-draft";
import type { ContactCard, ContactCardPatch } from "@/lib/models/contacts-types";

type NameComponent = NonNullable<NonNullable<ContactCard["name"]>["components"]>[number];
type DraftKind = "given" | "given2" | "surname";

const DRAFT_KINDS: DraftKind[] = ["given", "given2", "surname"];

/** The kinds a new name part goes before, so a given name lands ahead of the surname. */
const PLACE_BEFORE: Record<DraftKind, string[]> = {
  given: ["given2", "surname", "surname2", "generation", "credential"],
  given2: ["surname", "surname2", "generation", "credential"],
  surname: ["surname2", "generation", "credential"],
};

export function componentValue(
  components: NonNullable<ContactCard["name"]>["components"],
  kind: "given" | "given2" | "surname" | "surname2",
): string {
  return (components ?? [])
    .filter((component) => component.kind === kind)
    .map((component) => component.value.trim())
    .filter(Boolean)
    .join(" ");
}

export function splitFullName(fullName: string): { given: string; surname: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return {
      given: parts.slice(0, -1).join(" "),
      surname: parts[parts.length - 1] ?? "",
    };
  }
  return { given: fullName.trim(), surname: "" };
}

function draftNameParts(draft: ContactEditDraft): Record<DraftKind, string> {
  return {
    given: draft.nameGiven.trim(),
    given2: draft.nameGiven2.trim(),
    surname: draft.nameSurname.trim(),
  };
}

/**
 * The card's name components with the draft's given, middle and surnames in place.
 * Every other part (title, credential, generation, second surname) stays as it is.
 */
function nameComponentsWithDraft(draft: ContactEditDraft, active: ContactCard): NameComponent[] {
  const parts = draftNameParts(draft);
  const components: NameComponent[] = [];
  const placed = new Set<string>();
  for (const component of active.name?.components ?? []) {
    if (component.kind === "separator") continue;
    if (!(DRAFT_KINDS as string[]).includes(component.kind)) {
      components.push(component);
      continue;
    }
    const kind = component.kind as DraftKind;
    if (placed.has(kind)) continue;
    placed.add(kind);
    if (parts[kind]) components.push({ ...component, value: parts[kind] });
  }
  for (const kind of DRAFT_KINDS) {
    if (placed.has(kind) || !parts[kind]) continue;
    const component = { kind, value: parts[kind] } as NameComponent;
    const at = components.findIndex((row) => PLACE_BEFORE[kind].includes(row.kind));
    if (at < 0) components.push(component);
    else components.splice(at, 0, component);
  }
  return components;
}

/** "Dr. Jane Q Doe, PhD": titles, given names, surnames, generation, then credentials. */
function fullNameFromComponents(components: NameComponent[]): string {
  const values = (kinds: string[]) =>
    components
      .filter((component) => kinds.includes(component.kind))
      .map((component) => component.value.trim())
      .filter(Boolean);
  const main = [
    ...values(["title"]),
    ...values(["given", "given2"]),
    ...values(["surname", "surname2"]),
    ...values(["generation"]),
  ].join(" ");
  return [main, ...values(["credential"])].filter(Boolean).join(", ");
}

/** The name patch for a draft, or undefined when the draft's name parts match the card. */
export function patchName(
  draft: ContactEditDraft,
  active: ContactCard,
): ContactCardPatch["name"] | undefined {
  const parts = draftNameParts(draft);
  const components = active.name?.components ?? [];
  const current = {
    given: componentValue(components, "given"),
    given2: componentValue(components, "given2"),
    surname: componentValue(components, "surname"),
  };
  const full = active.name?.full?.trim() ?? "";

  if (current.given || current.given2 || current.surname) {
    // The card has name parts: unchanged means the same parts (the full name is derived).
    if (DRAFT_KINDS.every((kind) => current[kind] === parts[kind])) return undefined;
  } else if (full) {
    // Only a full name: the draft split it into given and surname.
    const split = splitFullName(full);
    if (split.given === parts.given && split.surname === parts.surname && !parts.given2) {
      return undefined;
    }
  } else if (!parts.given && !parts.given2 && !parts.surname) {
    return undefined;
  }

  const next = nameComponentsWithDraft(draft, active);
  const nextFull = fullNameFromComponents(next);
  return {
    isOrdered: false,
    components: next,
    ...(nextFull ? { full: nextFull } : {}),
  } as unknown as ContactCardPatch["name"];
}
