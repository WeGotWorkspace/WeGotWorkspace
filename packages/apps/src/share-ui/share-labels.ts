import type { ShareUIPermission } from "@/share-ui/share-access-map";

export const shareLabels = {
  dialogDescription: "Share a public link, or invite teammates and guests individually.",
  publicSectionTitle: "Anyone with the link",
  publicEnabledHint: "No sign-in required — anyone with the URL can view this doc.",
  publicDisabledHint: "Public access is off. Turn it on to share a link.",
  teamSectionTitle: "Team access",
  teamSectionHint: "Grant access to a whole group, or pick individual teammates.",
  guestSectionTitle: "Invite guests by email",
  guestSectionHint: "Each guest gets their own permission — invite once, control per person.",
  footerHint: "Access can also be granted on parent folders.",
  footerOpenAccess: "Open access manager",
  copyLink: "Copy link",
  regenerateLink: "Generate new link",
  regenerateLinkHint: "Generate a new link (invalidates the current one)",
  requirePassword: "Require password",
  passwordPlaceholder: "Set a password",
  passwordDisabledPlaceholder: "Password disabled",
  passwordDisableWarning: "Anyone with the link can open this without a password.",
  confirmCancel: "Cancel",
  confirmContinue: "Continue",
  disablePublicLinkTitle: "Disable public link?",
  disablePublicLinkConfirm: "Anyone with the current link will lose access. Continue?",
  disablePasswordTitle: "Disable password?",
  disablePasswordConfirm: "The link will work without a password. Continue?",
  regenerateLinkTitle: "Generate new link?",
  regenerateLinkConfirm:
    "The current link will stop working immediately. Anyone with the old URL will need the new one. Continue?",
  invitePlaceholder: "name@company.com",
  inviteAction: "Invite",
  inviteGuest: "Invite guest",
  removeGuest: "Remove guest",
  removeGrant: "Remove access",
  enablePublicAccess: "Enable public access",
  noAccess: "No access",
  addTeamGrantPlaceholder: "Add people or groups…",
  pendingGuest: "Pending",
  membersSuffix: (count: number) => `${count} members`,
  inheritedFrom: (label: string) => `Inherited from ${label}`,
  viaGroup: (groupLabel: string) => `via ${groupLabel}`,
  loadError: "Could not load sharing settings.",
  mutationError: "Could not update sharing settings.",
  copiedLink: "Link copied.",
  publicLinkOpeningTitle: "Opening shared link…",
  publicLinkOpeningHint: "Checking access and preparing your workspace.",
  publicLinkPasswordTitle: "This link is password protected",
  publicLinkPasswordHint: "Enter the password shared with you to continue.",
  publicLinkPasswordRequired: "Enter the correct password to open this link.",
  publicLinkContinue: "Continue",
  publicLinkErrorTitle: "Could not open link",
  publicLinkOpenError: "This share link is invalid or has expired.",
  publicLinkMissingToken: "This share URL is missing a token.",
  publicLinkErrorHint: "Ask the owner for a new link, or",
  publicLinkSignIn: "sign in to your workspace",
} as const;

export const sharePermissionLabels: Record<
  ShareUIPermission,
  { label: string; shortLabel: string }
> = {
  view: { label: "Can view", shortLabel: "View" },
  suggest: { label: "Can suggest", shortLabel: "Suggest" },
  edit: { label: "Can edit", shortLabel: "Edit" },
  full: { label: "Full access", shortLabel: "Full" },
};

export function formatSharePathLabel(sharePath: string): string {
  const segments = sharePath.split("/").filter(Boolean);
  return segments.at(-1) ?? sharePath;
}
