import type { ContactCard, ContactCardPatch } from "@/contacts-core/src/contacts-types";

function stripNullMapEntries<T>(
  target: Record<string, T> | undefined,
  patch: Record<string, T | null> | undefined,
): void {
  if (!target || !patch) return;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete target[key];
  }
}

/**
 * Apply a JMAP Contact/set patch locally. Map fields treat `null` as delete
 * (omit the id) so optimistic UI never keeps a null anniversary/phone/note.
 */
export function mergeContactFromPatch(active: ContactCard, patch: ContactCardPatch): ContactCard {
  const merged: ContactCard = {
    ...active,
    ...patch,
    name: patch.name ?? active.name,
    phones: { ...active.phones, ...patch.phones },
    emails: { ...active.emails, ...patch.emails },
    addresses: { ...active.addresses, ...patch.addresses },
    organizations: { ...active.organizations, ...patch.organizations },
    notes: { ...active.notes, ...patch.notes },
    anniversaries: { ...active.anniversaries, ...patch.anniversaries },
  };
  stripNullMapEntries(merged.phones, patch.phones);
  stripNullMapEntries(merged.emails, patch.emails);
  stripNullMapEntries(merged.addresses, patch.addresses);
  stripNullMapEntries(merged.organizations, patch.organizations);
  stripNullMapEntries(merged.notes, patch.notes);
  stripNullMapEntries(merged.anniversaries, patch.anniversaries);
  if (merged.anniversaries && Object.keys(merged.anniversaries).length === 0) {
    delete merged.anniversaries;
  }
  return merged;
}
