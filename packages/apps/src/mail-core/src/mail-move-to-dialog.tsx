import { useEffect, useMemo, useState } from "react";
import { Inbox as InboxIcon } from "lucide-react";
import { Button } from "@/button/src/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { DestinationPickerFrame } from "@/destination-picker/src/destination-picker-frame";
import { DestinationPickerList } from "@/destination-picker/src/destination-picker-list";
import type { MailUILabels } from "@/mail-core/src/mail-app.stories.fixtures";
import { canMoveMailItemsToMailbox } from "@/mail-core/src/mail-move-dialog";
import { mailboxIconForLabel } from "@/mail-core/src/mailbox-icons";
import { PathBreadcrumb } from "@/path-breadcrumb/src/path-breadcrumb";
import type { Mail } from "@/types/mail";
import "@/destination-picker/src/destination-picker.css";

const MAILBOX_PICKER_ROOT = "mailboxes";

export function MailMoveToDialog({
  open,
  labels,
  mailboxes,
  mail,
  moveIds,
  currentMailbox,
  encodeFolderToken,
  onClose,
  onConfirm,
}: {
  open: boolean;
  labels: MailUILabels;
  mailboxes: readonly string[];
  mail: Mail[];
  moveIds: string[];
  currentMailbox?: string;
  encodeFolderToken: (label: string) => string;
  onClose: () => void;
  onConfirm: (mailbox: string) => void;
}) {
  const initialMailbox = useMemo(() => {
    if (
      currentMailbox &&
      canMoveMailItemsToMailbox(mail, moveIds, currentMailbox, encodeFolderToken)
    ) {
      return currentMailbox;
    }
    return (
      mailboxes.find((mailbox) =>
        canMoveMailItemsToMailbox(mail, moveIds, mailbox, encodeFolderToken),
      ) ?? null
    );
  }, [currentMailbox, encodeFolderToken, mail, mailboxes, moveIds]);

  const [selectedMailbox, setSelectedMailbox] = useState<string | null>(initialMailbox);

  useEffect(() => {
    if (open) setSelectedMailbox(initialMailbox);
  }, [initialMailbox, open]);

  const items = useMemo(
    () =>
      mailboxes.map((mailbox) => ({
        id: mailbox,
        title: mailbox,
        icon: mailboxIconForLabel(mailbox, "size-4"),
        selectable: canMoveMailItemsToMailbox(mail, moveIds, mailbox, encodeFolderToken),
      })),
    [encodeFolderToken, mail, mailboxes, moveIds],
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="mail-dialog-surface sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{labels.moveDialogTitle}</DialogTitle>
          <DialogDescription>{labels.moveDialogDescription}</DialogDescription>
        </DialogHeader>

        {open ? (
          <DestinationPickerFrame
            breadcrumbs={
              <PathBreadcrumb
                size="default"
                className="destination-picker__breadcrumbs"
                leadingIcon={<InboxIcon className="size-3.5" />}
                items={[{ label: labels.moveDialogBreadcrumb, path: MAILBOX_PICKER_ROOT }]}
                currentPath={MAILBOX_PICKER_ROOT}
              />
            }
          >
            <DestinationPickerList
              items={items}
              selectedId={selectedMailbox}
              onSelect={setSelectedMailbox}
            />
          </DestinationPickerFrame>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {labels.moveDialogCancel}
          </Button>
          <Button
            variant="primary"
            disabled={!selectedMailbox}
            onClick={() => {
              if (!selectedMailbox) return;
              onConfirm(selectedMailbox);
            }}
          >
            {labels.moveDialogConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
