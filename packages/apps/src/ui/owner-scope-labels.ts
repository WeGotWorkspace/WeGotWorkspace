export const PERSONAL_SCOPE_VALUE = "__personal__";

export type OwnerScopeGroupOption = {
  slug: string;
  displayName: string;
};

export type OwnerScopeFieldLabels = {
  label: string;
  personal: (ownerLabel: string) => string;
  group: (name: string) => string;
  readOnlyLabel: string;
};

export const defaultOwnerScopeLabels: OwnerScopeFieldLabels = {
  label: "Owner",
  personal: () => "Only Me",
  group: (name) => `${name} (Group)`,
  readOnlyLabel: "Owner",
};

export function ownerScopeDisplayLabel(
  scope: "personal" | "group" | undefined,
  groupSlug: string | null | undefined,
  groups: readonly OwnerScopeGroupOption[],
  personalOwnerLabel: string,
  labels: Pick<OwnerScopeFieldLabels, "personal" | "group"> = defaultOwnerScopeLabels,
): string {
  if (scope !== "group" || !groupSlug) return labels.personal(personalOwnerLabel);
  const group = groups.find((entry) => entry.slug === groupSlug);
  return labels.group(group?.displayName ?? groupSlug);
}

export function ownerScopeValueFromDirectory(
  scope?: "personal" | "group",
  groupSlug?: string | null,
): string {
  return scope === "group" && groupSlug ? groupSlug : PERSONAL_SCOPE_VALUE;
}

export function groupSlugFromOwnerScopeValue(value: string): string | null {
  return value === PERSONAL_SCOPE_VALUE ? null : value;
}
