import type { TeamOwnerOption } from "@/lib/sharing/team-owner-options";
import { workspaceLabels } from "@/lib/workspace/workspace-labels";

export const PERSONAL_SCOPE_VALUE = "__personal__";

export type OwnerScopeGroupOption = TeamOwnerOption;

export type OwnerScopeFieldLabels = {
  label: string;
  personal: (ownerLabel: string) => string;
  group: (name: string) => string;
  readOnlyLabel: string;
  /** Under the caption when the viewer is in Teams but team admin of none (#2368). */
  noTeamAdminHint?: string;
};

export const defaultOwnerScopeLabels: OwnerScopeFieldLabels = {
  label: workspaceLabels.sharing.owner,
  personal: () => "Only Me",
  group: (name) => `${name} (Team)`,
  readOnlyLabel: workspaceLabels.sharing.owner,
  noTeamAdminHint: workspaceLabels.sharing.ownerNeedsTeamAdmin,
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
