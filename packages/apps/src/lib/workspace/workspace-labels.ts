/**
 * Shared base for user-visible copy that every workspace app repeats (#1641 step b).
 *
 * App label files (`notes-labels.ts`, `tasks-labels.ts`, …) keep their own keys and
 * take these values, so one string has one source. Only move a string here when it
 * means the same thing everywhere: "None" as an alarm choice and "None" as a paper
 * size stay in their own files.
 */
export type WorkspaceLabels = {
  /** Buttons and fields in confirm, create and edit dialogs. */
  dialog: {
    cancel: string;
    delete: string;
    edit: string;
    save: string;
    create: string;
    remove: string;
    move: string;
    done: string;
    retry: string;
    /** Follows a permanent-delete description: "… This action cannot be undone." */
    deleteConfirmSuffix: string;
    /** Starts a permanent-delete description: "This will permanently delete …". */
    permanentDeleteLeadIn: string;
    /** Name field of a collection dialog (notebook, calendar, channel, group, address book). */
    nameField: string;
    /** Color field of a collection dialog. */
    colorField: string;
  };
  /**
   * Share dialogs, shared sections and owner changes. The people-picker copy
   * (placeholder, section hint, remove confirm) lives in `sharePrincipalCopy`.
   */
  sharing: {
    sharedWithMe: string;
    viewOnly: string;
    removeAccessTitle: string;
    teamAccess: string;
    copyLink: string;
    owner: string;
    changeOwner: string;
    changeOwnerTitle: string;
  };
  /** Offline sync state and conflict prompts. */
  sync: {
    pending: string;
    changesSynced: string;
    failedTitle: string;
    conflictTitle: string;
    keepMine: string;
  };
  /** List and sidebar chrome. */
  list: {
    moreCreateOptions: string;
    listUpdated: string;
  };
};

export const workspaceLabels = {
  dialog: {
    cancel: "Cancel",
    delete: "Delete",
    edit: "Edit",
    save: "Save",
    create: "Create",
    remove: "Remove",
    move: "Move",
    done: "Done",
    retry: "Retry",
    deleteConfirmSuffix: "This action cannot be undone.",
    permanentDeleteLeadIn: "This will permanently delete ",
    nameField: "Name",
    colorField: "Color",
  },
  sharing: {
    sharedWithMe: "Shared with me",
    viewOnly: "View only",
    removeAccessTitle: "Remove access?",
    teamAccess: "Team access",
    copyLink: "Copy link",
    owner: "Owner",
    changeOwner: "Change owner",
    changeOwnerTitle: "Change owner?",
  },
  sync: {
    pending: "Pending sync",
    changesSynced: "Changes synced",
    failedTitle: "Some changes could not sync",
    conflictTitle: "Sync conflict",
    keepMine: "Keep mine",
  },
  list: {
    moreCreateOptions: "More create options",
    listUpdated: "List updated",
  },
} as const satisfies WorkspaceLabels;

/**
 * Applies a caller's partial overrides (stories, tests, product embeds) on top of an
 * app's default labels. Every app's `merge*Labels` binds this to its own defaults.
 */
export function mergeWorkspaceLabels<T extends object>(defaults: T, overrides?: Partial<T>): T {
  if (!overrides) return defaults;
  return { ...defaults, ...overrides };
}
