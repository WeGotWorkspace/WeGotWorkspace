/** Copy for a team admin's member management (#2278). */
export const teamMembersLabels = {
  manage: "Manage members",
  manageOf: (team: string) => `Manage members of ${team}`,
  title: (team: string) => `Edit ${team}`,
  titleFallback: "Team members",
  description: "Changes apply right away.",
  nameLabel: "Name",
  nameHint: "Renaming is done in Admin.",
  sectionTitle: "Members",
  sectionHint: "Members see everything this Team owns.",
  soleTeamAdminHint:
    "Members see everything this Team owns. The only team admin stays: appoint another first.",
  addPlaceholder: "Add by name or email",
  noCandidates: "No one found",
  loading: "Loading members",
  roleMember: "Member",
  roleTeamAdmin: "Team admin",
  roleOf: (name: string) => `Role of ${name}`,
  removeLabel: (name: string) => `Remove ${name}`,
  removeTitle: (name: string, team: string) => `Remove ${name} from ${team}?`,
  removeConfirm:
    "They lose access to everything this Team owns, in every app. Their own items stay.",
  removeAction: "Remove",
  leaveTitle: (team: string) => `Leave ${team}?`,
  leaveConfirm:
    "You lose access to everything this Team owns, in every app. Another Team admin or an organization admin can add you again.",
  leaveAction: "Leave",
  cancel: "Cancel",
  done: "Done",
  genericError: "Something went wrong. Try again.",
} as const;
