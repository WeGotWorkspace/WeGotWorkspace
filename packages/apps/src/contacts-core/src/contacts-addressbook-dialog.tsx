import { useState } from "react";
import { Button } from "@/button/src/button";
import { Input } from "@/ui/input";
import { FieldLabelRow } from "@/ui/field-label-row";
import { SwatchColorPicker } from "@/ui/swatch-color-picker";
import { ColorSwatchTrigger } from "@/ui/color-swatch-trigger";
import { NAME_COLOR_ROW_INPUT_CLASS, NameColorRow } from "@/ui/name-color-row";
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
import type { CollectionSharePrincipal, CollectionShareWith } from "@/share-ui/collection-share";
import {
  ADDRESS_BOOK_DOT_COLORS,
  addressBookDotColor,
} from "@/contacts-core/src/contacts-addressbook-color";
import type { ContactsAddressBookDialogState } from "@/contacts-core/src/contacts-addressbook-write";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";
import { persistAddressBookColor } from "@/contacts-core/src/contacts-view-prefs";
import { useAddressBookColorOverrides } from "@/contacts-core/src/use-contacts-addressbook-colors";
import "@/share-ui/share-ui.css";
import "@/contacts-core/src/contacts-addressbook-dialog.css";

export type { ContactsAddressBookDialogState };

export type ContactsAddressBookDialogShare = {
  knownPrincipals?: readonly CollectionSharePrincipal[];
  online?: boolean;
  onSearchPrincipals: (query: string) => Promise<CollectionSharePrincipal[]>;
  onPatchShareWith: (bookId: string, shareWith: CollectionShareWith) => Promise<void>;
};

export type ContactsAddressBookDialogLabels = Pick<
  ContactsUILabels,
  | "addressBookSettingsTitle"
  | "addressBookNameLabel"
  | "addressBookColorLabel"
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
    addressBookNameLabel: labels.addressBookNameLabel,
    addressBookColorLabel: labels.addressBookColorLabel,
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
  const colorOverrides = useAddressBookColorOverrides();
  const open = dialog !== null;
  const showShare = Boolean(dialog?.mayShare) && Boolean(share);
  const canRemoveShared = Boolean(dialog?.isSharee) && Boolean(onRemoveShared);
  const selectedColor = dialog
    ? addressBookDotColor({ id: dialog.bookId }, colorOverrides)
    : ADDRESS_BOOK_DOT_COLORS[0];

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
                label={labels.addressBookNameLabel}
                htmlFor="contacts-addressbook-name"
                readOnly
              >
                <NameColorRow>
                  <Input
                    id="contacts-addressbook-name"
                    className={NAME_COLOR_ROW_INPUT_CLASS}
                    value={dialog.name}
                    readOnly
                  />
                  <SwatchColorPicker
                    value={selectedColor}
                    onChange={(color) => persistAddressBookColor(dialog.bookId, color)}
                    colorLabel={labels.addressBookColorLabel}
                    swatches={ADDRESS_BOOK_DOT_COLORS}
                  >
                    <ColorSwatchTrigger
                      color={selectedColor}
                      label={labels.addressBookColorLabel}
                      aria-haspopup="dialog"
                    />
                  </SwatchColorPicker>
                </NameColorRow>
              </FieldLabelRow>

              {showShare && share ? (
                <div className="contacts-addressbook-dialog__share">
                  <CollectionShareSection
                    collectionId={dialog.bookId}
                    shareWith={dialog.shareWith}
                    knownPrincipals={share.knownPrincipals}
                    online={share.online}
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
                </div>
              ) : null}

              <DialogFooter className="contacts-addressbook-dialog__footer">
                {canRemoveShared ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="contacts-addressbook-dialog__remove"
                    onClick={() => setConfirmRemoveOpen(true)}
                  >
                    {labels.removeSharedAddressBook}
                  </Button>
                ) : null}
                <Button type="button" variant="outline" onClick={onClose}>
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
