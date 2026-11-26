/**
 * Teams as the owner of a new or moved collection (calendar, task list, notebook, channel).
 * The API lets only a team admin add a collection to a Team (#2278), so every owner picker
 * offers a Team only to its team admins and every app shares this one rule.
 */

const GROUP_PRINCIPAL_PREFIX = "principals/groups/";

export type TeamOwnerOption = {
  slug: string;
  displayName: string;
  /**
   * The viewer is team admin of the Team. Absent when the source does not say (an older
   * cached answer): the Team is offered and the API gives the final answer.
   */
  isTeamAdmin?: boolean;
};

/** `settings/state` groups → owner options, keeping the team-admin flag. */
export function mapSettingsGroupsToTeamOptions(
  groups: readonly { id: string; displayName: string; isTeamAdmin?: boolean }[],
): TeamOwnerOption[] {
  return groups.map((group) => {
    const slug = group.id.startsWith(GROUP_PRINCIPAL_PREFIX)
      ? group.id.slice(GROUP_PRINCIPAL_PREFIX.length)
      : group.id;
    return {
      slug,
      displayName: group.displayName?.trim() || slug,
      ...(typeof group.isTeamAdmin === "boolean" ? { isTeamAdmin: group.isTeamAdmin } : {}),
    };
  });
}

/**
 * The Teams an owner picker lists: those where the viewer is team admin, plus the
 * collection's current Team (`keepSlug`) so an open edit still shows where it lives.
 */
export function teamsOfferedAsOwner<T extends TeamOwnerOption>(
  groups: readonly T[],
  keepSlug?: string | null,
): T[] {
  return groups.filter((group) => group.isTeamAdmin !== false || group.slug === keepSlug);
}

/**
 * The viewer is in at least one Team but may add to none of them: the picker explains
 * why Teams are missing. Nothing to explain when they are in no Team at all.
 */
export function viewerIsAdminOfNoTeam(groups: readonly TeamOwnerOption[] | undefined): boolean {
  return Boolean(groups?.length) && groups!.every((group) => group.isTeamAdmin === false);
}
