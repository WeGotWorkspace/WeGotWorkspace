import type { ShareUIPermission } from "@/lib/sharing/share-access-map";
import { workspaceLabels } from "@/lib/workspace/workspace-labels";

/**
 * Principal-sharing copy used by every app's share dialog (Drive, Docs, Calendar,
 * Tasks, Notes, Meet, Contacts). App label modules reference these instead of copying them.
 */
export const sharePrincipalCopy = {
  addPlaceholder: "Add people or teams…",
  sectionHint: "Grant read or read-and-write access to people or teams.",
  removeConfirm: (item: string) =>
    `This person or team will lose access to this ${item}. Continue?`,
} as const;

/** Wherever people are picked, for a viewer who is in no Team (#1924). */
export const noTeamYetCopy = "You're not in a Team yet. Ask your admin to add you.";

/** A people-and-Teams picker whose search matched nothing. */
export const noPeopleOrTeamsFoundCopy = "No people or teams found";

export const shareLabels = {
  publicSectionTitle: "Public link",
  turnOnPublicLink: "Turn on the public link",
  turnOffPublicLink: "Turn off the public link",
  publicEnabledHint: "No sign-in required — anyone with the URL can view this doc.",
  publicEnabledAddFilesHint:
    "No sign-in required — anyone with the URL can view this folder and add files to it.",
  linkLabel: "Link",
  publicLevelLabel: "People with the link",
  publicLevelView: "Can view",
  publicLevelAddFiles: "Can add files",
  publicDisabledHint: "Public access is off. Turn it on to share a link.",
  teamSectionTitle: workspaceLabels.sharing.teamAccess,
  teamSectionHint: "Grant access to a whole team, or pick individual teammates.",
  guestSectionTitle: "Invite guests by email",
  guestSectionHint: "Each guest gets their own permission — invite once, control per person.",
  copyLink: workspaceLabels.sharing.copyLink,
  regenerateLink: "Generate new link",
  regenerateLinkHint: "Generate a new link (invalidates the current one)",
  requirePassword: "Require password",
  stopRequiringPassword: "Stop requiring a password",
  passwordLabel: "Password",
  passwordPlaceholder: "Set a password",
  passwordHiddenLabel: "Password is set (hidden)",
  copyPassword: "Copy password",
  copiedPassword: "Password copied.",
  regeneratePassword: "Generate new password",
  regeneratePasswordHint: "Generate a new password (invalidates the current one)",
  regeneratePasswordToViewHint: "Generate a new password to view and copy it",
  confirmCancel: workspaceLabels.dialog.cancel,
  confirmContinue: "Continue",
  disablePublicLinkTitle: "Disable public link?",
  disablePublicLinkConfirm: "Anyone with the current link will lose access. Continue?",
  disablePasswordTitle: "Disable password?",
  disablePasswordConfirm: "The link will work without a password. Continue?",
  regenerateLinkTitle: "Generate new link?",
  regenerateLinkConfirm:
    "The current link will stop working immediately. Anyone with the old URL will need the new one. Continue?",
  regeneratePasswordTitle: "Generate new password?",
  regeneratePasswordConfirm:
    "The current password will stop working immediately. Anyone with the old password will need the new one. Continue?",
  invitePlaceholder: "name@company.com",
  inviteAction: "Invite",
  inviteGuest: "Invite guest",
  removeGuest: "Remove guest",
  removeGrant: "Remove access",
  removeGrantTitle: workspaceLabels.sharing.removeAccessTitle,
  removeGrantConfirm: sharePrincipalCopy.removeConfirm("item"),
  noAccess: "No access",
  addTeamGrantPlaceholder: sharePrincipalCopy.addPlaceholder,
  pendingGuest: "Pending",
  membersSuffix: (count: number) => `${count} members`,
  inheritedFrom: (label: string) => `Inherited from ${label}`,
  viaGroup: (groupLabel: string) => `via ${groupLabel}`,
  loadError: "Could not load sharing settings.",
  mutationError: "Could not update sharing settings.",
  guestAlreadyHasAccess: "This guest already has access.",
  copiedLink: "Link copied.",
  publicLinkOpeningTitle: "Opening shared link…",
  publicLinkOpeningHint: "Checking access and preparing your workspace.",
  publicLinkPasswordTitle: "This link is password protected",
  publicLinkPasswordHint: "Enter the password shared with you to continue.",
  publicLinkPasswordRequired: "Enter the correct password to open this link.",
  publicLinkContinue: "Continue",
  publicLinkErrorTitle: "Could not open link",
  publicLinkOpenError: "This share link is invalid or has expired.",
  publicLinkDownloadError: "The download could not start. Try again in a moment.",
  publicLinkMissingToken: "This share URL is missing a token.",
  publicLinkErrorHint: "Ask the owner for a new link, or",
  publicLinkSignIn: "sign in to your workspace",
  publicLinkDownloadTitle: "Download started",
  publicLinkDownloadHint: "Your browser should save the shared file. You can close this tab.",
} as const;

export const sharePermissionLabels: Record<
  ShareUIPermission,
  { label: string; shortLabel: string }
> = {
  view: { label: "Can view", shortLabel: "View" },
  comment: { label: "Can comment", shortLabel: "Comment" },
  edit: { label: "Can edit", shortLabel: "Edit" },
  full: { label: "Full access", shortLabel: "Full" },
};

export function formatSharePathLabel(sharePath: string): string {
  const segments = sharePath.split("/").filter(Boolean);
  return segments.at(-1) ?? sharePath;
}
