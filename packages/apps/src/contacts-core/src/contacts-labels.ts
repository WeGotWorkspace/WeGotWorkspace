import { workspaceDestructiveDialogLabels } from "@/lib/workspace/destructive-dialog";

/**
 * User-visible copy for the contacts workspace (sidebar, list chrome, dialogs, toasts).
 * Override via {@link ContactsWorkspaceProps.labels} in stories/tests.
 */
export type ContactsUILabels = {
  listLoading: string;
  refreshList: string;
  searchPlaceholder: string;
  sidebarAllContacts: string;
  sidebarSharedWithMe: string;
  /** Fixed product name for the user's owned personal book. */
  personalAddressBook: string;
  /** Owned/team collections heading — same pattern as Tasks “My lists” / Notes “My notebooks”. */
  sectionAddressBooks: string;
  sectionGroups: string;
  viewOnly: string;
  editAddressBook: string;
  newContactMenu: string;
  listSelected: (count: number) => string;
  listContacts: (count: number) => string;
  emptyList: string;
  emptyGroupMembers: string;
  renameGroup: string;
  renameGroupDescription: string;
  deleteGroup: string;
  newGroup: string;
  createGroupNameLabel: string;
  createGroupAddressBookLabel: string;
  createGroupAddressBookHint: string;
  createGroupButton: string;
  addGroup: string;
  addGroupPlaceholder: string;
  toastGroupRenamed: (name: string) => string;
  newContact: string;
  createContact: string;
  importVcf: string;
  importDialogTitle: string;
  importDestinationLegend: string;
  importSubmit: string;
  dropImportHint: string;
  toastImported: (count: number) => string;
  importInvalidFile: string;
  importFilesSkipped: (count: number) => string;
  importRequiresApi: string;
  importFailed: string;
  importPartialFailure: (count: number) => string;
  importFilesFailed: (count: number) => string;
  importProgress: (imported: number, total: number, batch: number, batches: number) => string;
  importCardTooLarge: string;
  unknownContact: string;
  edit: string;
  save: string;
  cancel: string;
  delete: string;
  sectionName: string;
  sectionPhones: string;
  sectionEmails: string;
  sectionAddresses: string;
  sectionOrganization: string;
  sectionNotes: string;
  sectionUrls: string;
  sectionBirthday: string;
  companyContact: string;
  nameFull: string;
  nameGiven: string;
  nameGiven2: string;
  nameSurname: string;
  channelType: string;
  channelTypeNone: string;
  channelLabelNone: string;
  channelTypeHome: string;
  channelTypeWork: string;
  channelTypeSchool: string;
  /** JSContact `features.mobile` / vCard TYPE=CELL */
  channelTypeMobile: string;
  phoneNumber: string;
  emailAddress: string;
  organizationName: string;
  /** JSContact `titles` (kind title) / vCard TITLE */
  jobTitle: string;
  /** JSContact `organizations[].units[0]` / vCard ORG unit */
  jobDepartment: string;
  notesText: string;
  /** Placeholder on the trailing empty phone row. */
  addPhone: string;
  /** Placeholder on the trailing empty email row. */
  addEmail: string;
  /** Placeholder on the trailing empty address row. */
  addAddress: string;
  /** Placeholder on the trailing empty URL row. */
  addUrl: string;
  urlAddress: string;
  addressStreet: string;
  addressLocality: string;
  addressRegion: string;
  addressPostalCode: string;
  addressCountry: string;
  addressLine: string;
  removeRow: string;
  toastCreated: string;
  toastSaved: string;
  toastDeleted: string;
  toastSyncConflict: (name: string) => string;
  toastSyncConflictOpen: string;
  pendingSync: string;
  conflictTitle: string;
  conflictDescription: (name: string) => string;
  conflictRemaining: (count: number) => string;
  conflictKeepMine: string;
  conflictUseServer: string;
  conflictDescriptionFieldMerge: (name: string) => string;
  conflictFieldLocal: string;
  conflictFieldServer: string;
  conflictApplyMerge: string;
  syncFailedTitle: string;
  syncFailedMessage: string;
  retrySync: string;
  downloadVCard: string;
  selectionDelete: string;
  selectionRemoveFromGroup: string;
  selectionDownload: string;
  selectionDone: string;
  swipeDelete: string;
  swipeRemoveFromGroup: string;
  toastRemovedFromGroup: (count: number) => string;
  toastGroupCreated: (name: string) => string;
  toastMembersAdded: (count: number, groupName: string) => string;
  deleteContactTitle: string;
  deleteContactDescription: (count: number) => string;
  deleteGroupTitle: string;
  deleteGroupDescription: (name: string) => string;
  toastGroupDeleted: (name: string) => string;
  deleteConfirm: string;
  deleteCancel: string;
  addressBookSettingsTitle: string;
  addressBookNameLabel: string;
  addressBookColorLabel: string;
  addressBookDialogDone: string;
  shareAddressBookTitle: string;
  shareAddressBookHint: string;
  shareAddressBookPlaceholder: string;
  shareAddressBookEmpty: string;
  shareAddressBookOffline: string;
  removeAddressBookShareTitle: string;
  removeAddressBookShareConfirm: string;
  removeSharedAddressBook: string;
  removeSharedAddressBookConfirmTitle: string;
  removeSharedAddressBookConfirmDescription: string;
  toastAddressBookShareRemoved: string;
};

export const defaultContactsLabels: ContactsUILabels = {
  listLoading: "Loading contacts…",
  refreshList: "Refresh contacts",
  searchPlaceholder: "Search contacts...",
  sidebarAllContacts: "All contacts",
  sidebarSharedWithMe: "Shared with me",
  personalAddressBook: "Personal",
  sectionAddressBooks: "My address books",
  sectionGroups: "Groups",
  viewOnly: "View only",
  editAddressBook: "Address book settings",
  newContactMenu: "More create options",
  listSelected: (count) => `${count} Selected`,
  listContacts: (count) => `${count} Contacts`,
  emptyList: "No contacts",
  emptyGroupMembers: "No members in this group",
  renameGroup: "Rename group",
  renameGroupDescription: "The group name will update in your address books and sidebar.",
  deleteGroup: "Delete group",
  newGroup: "New group",
  createGroupNameLabel: "Name",
  createGroupAddressBookLabel: "Address book",
  createGroupAddressBookHint: "The group is stored in this address book. You cannot move it later.",
  createGroupButton: "Create",
  addGroup: "Add group",
  addGroupPlaceholder: "Add group…",
  toastGroupRenamed: (name) => `Renamed to “${name}”`,
  newContact: "New contact",
  createContact: "Create contact",
  importVcf: "Import vCards",
  importDialogTitle: "Import vCards",
  importDestinationLegend: "Address book",
  importSubmit: "Import",
  dropImportHint: "Drop vCard files to import",
  toastImported: (count) => `Imported ${count} contact${count === 1 ? "" : "s"}`,
  importInvalidFile: "Choose one or more .vcf or .vcard files to import.",
  importFilesSkipped: (count) => `Skipped ${count} non-vCard file${count === 1 ? "" : "s"}.`,
  importRequiresApi: "vCard import requires a connected contacts API.",
  importFailed: "Could not import vCard files.",
  importPartialFailure: (count) =>
    `${count} contact${count === 1 ? "" : "s"} could not be imported.`,
  importFilesFailed: (count) => `${count} file${count === 1 ? "" : "s"} could not be imported.`,
  importProgress: (imported, total, batch, batches) =>
    `Imported ${imported} of ${total} (batch ${batch} of ${batches})`,
  importCardTooLarge:
    "A single contact is larger than the server upload limit and cannot be split.",
  unknownContact: "Unknown contact",
  edit: "Edit",
  save: "Save",
  cancel: "Cancel",
  delete: "Delete",
  sectionName: "Name",
  sectionPhones: "Phones",
  sectionEmails: "Emails",
  sectionAddresses: "Addresses",
  sectionOrganization: "Organization",
  sectionNotes: "Notes",
  sectionUrls: "URLs",
  sectionBirthday: "Birthday",
  companyContact: "Company contact",
  nameFull: "Full name",
  nameGiven: "First name",
  nameGiven2: "Middle name",
  nameSurname: "Last name",
  channelType: "Type",
  channelTypeNone: "Other",
  channelLabelNone: "None",
  channelTypeHome: "Home",
  channelTypeWork: "Work",
  channelTypeSchool: "School",
  channelTypeMobile: "Mobile",
  phoneNumber: "Phone number",
  emailAddress: "Email address",
  organizationName: "Organization",
  jobTitle: "Job title",
  jobDepartment: "Department",
  notesText: "Notes",
  addPhone: "Add phone",
  addEmail: "Add email",
  addAddress: "Add address",
  addUrl: "Add URL",
  urlAddress: "URL",
  addressStreet: "Street",
  addressLocality: "City",
  addressRegion: "State / region",
  addressPostalCode: "Postal code",
  addressCountry: "Country",
  addressLine: "Street address",
  removeRow: "Remove",
  toastCreated: "Contact created",
  toastSaved: "Contact saved",
  toastDeleted: "Contact deleted",
  toastSyncConflict: (name) =>
    `Could not sync changes to “${name}” because it was updated elsewhere.`,
  toastSyncConflictOpen: "Open contact",
  pendingSync: "Pending sync",
  conflictTitle: "Sync conflict",
  conflictDescription: (name) =>
    `“${name}” was changed somewhere else while you had unsynced edits. Which version should win?`,
  conflictRemaining: (count) => `${count} more contact${count === 1 ? "" : "s"} to review`,
  conflictKeepMine: "Keep mine",
  conflictUseServer: "Use server version",
  conflictDescriptionFieldMerge: (name) =>
    `“${name}” was changed elsewhere. Choose which value to keep for each field below.`,
  conflictFieldLocal: "Your edits",
  conflictFieldServer: "Server version",
  conflictApplyMerge: "Apply merged changes",
  syncFailedTitle: "Some changes couldn’t sync",
  syncFailedMessage: "We’ll keep your edits saved locally until they go through.",
  retrySync: "Retry",
  downloadVCard: "Download vCard",
  selectionDelete: "Delete",
  selectionRemoveFromGroup: "Remove from group",
  selectionDownload: "Download",
  selectionDone: "Done",
  swipeDelete: "Delete",
  swipeRemoveFromGroup: "Remove from group",
  toastRemovedFromGroup: (count) => `Removed ${count} contact${count === 1 ? "" : "s"} from group`,
  toastGroupCreated: (name) => `Group "${name}" created`,
  toastMembersAdded: (count, groupName) =>
    `Added ${count} contact${count === 1 ? "" : "s"} to ${groupName}`,
  deleteContactTitle: "Delete contact?",
  deleteContactDescription: (count) =>
    `This will permanently delete ${count} contact${count === 1 ? "" : "s"}.`,
  deleteGroupTitle: "Delete group?",
  deleteGroupDescription: (name) =>
    `Delete "${name}"? The group will be permanently deleted. Its contacts will not be affected.`,
  toastGroupDeleted: (name) => `Group "${name}" deleted`,
  deleteConfirm: workspaceDestructiveDialogLabels.dialogDelete,
  deleteCancel: workspaceDestructiveDialogLabels.dialogCancel,
  addressBookSettingsTitle: "Address book",
  addressBookNameLabel: "Name",
  addressBookColorLabel: "Color",
  addressBookDialogDone: "Done",
  shareAddressBookTitle: "Share address book",
  shareAddressBookHint: "People you add can open this address book in Contacts.",
  shareAddressBookPlaceholder: "Add people or groups",
  shareAddressBookEmpty: "No matches",
  shareAddressBookOffline: "Sharing is unavailable offline.",
  removeAddressBookShareTitle: "Remove access?",
  removeAddressBookShareConfirm: "They will no longer see this address book.",
  removeSharedAddressBook: "Remove address book",
  removeSharedAddressBookConfirmTitle: "Remove this shared address book?",
  removeSharedAddressBookConfirmDescription: "You will no longer see this address book.",
  toastAddressBookShareRemoved: "Address book removed",
};

export function mergeContactsLabels(overrides?: Partial<ContactsUILabels>): ContactsUILabels {
  if (!overrides) return defaultContactsLabels;
  return { ...defaultContactsLabels, ...overrides };
}
