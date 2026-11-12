import {
  SyncConflictDialog,
  type SyncConflictDialogProps,
} from "@/dialogs/src/sync-conflict-dialog";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";
import type { ContactConflictFieldKey } from "@/lib/offline/contacts-conflict-merge";

export type ContactsConflictDialogProps = Omit<
  SyncConflictDialogProps<ContactConflictFieldKey>,
  "itemName" | "labels" | "surfaceClassName"
> & {
  /** Display name of the contact currently being resolved. */
  contactName: string;
  labels: ContactsUILabels;
};

/** Field-level or binary resolver for a single contact sync conflict. */
export function ContactsConflictDialog({ contactName, ...props }: ContactsConflictDialogProps) {
  return (
    <SyncConflictDialog
      {...props}
      itemName={contactName}
      surfaceClassName="contacts-dialog-surface"
    />
  );
}
