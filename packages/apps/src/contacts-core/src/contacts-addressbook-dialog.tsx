import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/button/src/button";
import { IconButton } from "@/button/src/icon-button";
import { Input } from "@/ui/input";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { CollectionShareSection } from "@/share-ui/collection-share-section";
import type { CollectionSharePrincipal, CollectionShareWith } from "@/lib/sharing/collection-share";
import {
  contactsAddressBookDisplayName,
  type ContactsAddressBookDialogState,
} from "@/contacts-core/src/contacts-addressbook-write";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";
import "@/share-ui/share-ui.css";
import { NO_AUTOFILL } from "@/ui/no-autofill";

export type { ContactsAddressBookDialogState };

export type ContactsAddressBookDialogShare = {
  knownPrincipals?: readonly CollectionSharePrincipal[];
  online?: boolean;
  /** The viewer is in no Team (#1924). */
  noTeam?: boolean;
  onSearchPrincipals: (query: string) => Promise<CollectionSharePrincipal[]>;
  onPatchShareWith: (bookId: string, shareWith: CollectionShareWith) => Promise<void>;
};

export type ContactsAddressBookDialogLabels = Pick<
  ContactsUILabels,
  | "addressBookSettingsTitle"
  | "personalAddressBook"
  | "addressBookNameLabel"
  | "addressBookDialogDone"
  | "cancel"
  | "shareAddressBookTitle"
  | "shareAddressBookHint"
  | "shareAddressBookPlaceholder"
  | "shareAddressBookEmpty"
  | "shareAddressBookOffline"
  | "removeAddressBookShareTitle"
  | "removeAddressBookShareConfirm"
  | "removeSharedAddressBook"
  | "removeSharedAddressBookConfirmTitle"
  | "removeSharedAddressBookConfirmDescription"
>;

export function contactsAddressBookDialogLabelsFrom(
  labels: ContactsUILabels,
): ContactsAddressBookDialogLabels {
  return {
    addressBookSettingsTitle: labels.addressBookSettingsTitle,
    personalAddressBook: labels.personalAddressBook,
    addressBookNameLabel: labels.addressBookNameLabel,
    addressBookDialogDone: labels.addressBookDialogDone,
    cancel: labels.cancel,
    shareAddressBookTitle: labels.shareAddressBookTitle,
    shareAddressBookHint: labels.shareAddressBookHint,
    shareAddressBookPlaceholder: labels.shareAddressBookPlaceholder,
    shareAddressBookEmpty: labels.shareAddressBookEmpty,
    shareAddressBookOffline: labels.shareAddressBookOffline,
    removeAddressBookShareTitle: labels.removeAddressBookShareTitle,
    removeAddressBookShareConfirm: labels.removeAddressBookShareConfirm,
    removeSharedAddressBook: labels.removeSharedAddressBook,
    removeSharedAddressBookConfirmTitle: labels.removeSharedAddressBookConfirmTitle,
    removeSharedAddressBookConfirmDescription: labels.removeSharedAddressBookConfirmDescription,
  };
}

type ContactsAddressBookDialogProps = {
  dialog: ContactsAddressBookDialogState;
  labels: ContactsAddressBookDialogLabels;
  onClose: () => void;
  share?: ContactsAddressBookDialogShare;
  onRemoveShared?: () => void;
  contentClassName?: string;
};

export function ContactsAddressBookDialog({
  dialog,
  labels,
  onClose,
  share,
  onRemoveShared,
  contentClassName = "contacts-dialog-surface",
}: ContactsAddressBookDialogProps) {
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const open = dialog !== null;
  const showShare = Boolean(dialog?.mayShare) && Boolean(share);
  const canRemoveShared = Boolean(dialog?.isSharee) && Boolean(onRemoveShared);

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            setConfirmRemoveOpen(false);
            onClose();
          }
        }}
      >
        <DialogContent className={contentClassName} aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{labels.addressBookSettingsTitle}</DialogTitle>
          </DialogHeader>
          {dialog ? (
            <>
              <FieldLabelRow
                layout="inline"
                fill
                label={labels.addressBookNameLabel}
                htmlFor="contacts-addressbook-name"
                readOnly
              >
                <Input
                  id="contacts-addressbook-name"
                  {...NO_AUTOFILL}
                  value={contactsAddressBookDisplayName(
                    {
                      id: dialog.bookId,
                      name: dialog.name,
                      isSharee: dialog.isSharee,
                      isDefault: dialog.bookId === "default",
                    },
                    labels.personalAddressBook,
                  )}
                  readOnly
                />
              </FieldLabelRow>

              {showShare && share ? (
                <CollectionShareSection
                  collectionId={dialog.bookId}
                  shareWith={dialog.shareWith}
                  knownPrincipals={share.knownPrincipals}
                  online={share.online}
                  noTeam={share.noTeam}
                  dialogClassName={contentClassName}
                  copy={{
                    title: labels.shareAddressBookTitle,
                    hint: labels.shareAddressBookHint,
                    placeholder: labels.shareAddressBookPlaceholder,
                    empty: labels.shareAddressBookEmpty,
                    offline: labels.shareAddressBookOffline,
                    removeTitle: labels.removeAddressBookShareTitle,
                    removeConfirm: labels.removeAddressBookShareConfirm,
                  }}
                  onSearchPrincipals={share.onSearchPrincipals}
                  onPatchShareWith={share.onPatchShareWith}
                />
              ) : null}

              <DialogFooter
                start={
                  canRemoveShared ? (
                    <IconButton
                      type="button"
                      variant="outline"
                      severity="danger"
                      size="md"
                      icon={<Trash2 className="size-3.5" aria-hidden />}
                      label={labels.removeSharedAddressBook}
                      onClick={() => setConfirmRemoveOpen(true)}
                    />
                  ) : null
                }
              >
                <Button type="button" onClick={onClose}>
                  {labels.addressBookDialogDone}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmRemoveOpen} onOpenChange={setConfirmRemoveOpen}>
        <AlertDialogContent className={contentClassName}>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.removeSharedAddressBookConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {labels.removeSharedAddressBookConfirmDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmRemoveOpen(false);
                onRemoveShared?.();
              }}
            >
              {labels.removeSharedAddressBook}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
