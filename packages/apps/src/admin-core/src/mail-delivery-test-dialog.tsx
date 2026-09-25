import { useEffect, useRef, useState } from "react";
import { Button } from "@/button/src/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { FieldLabelRow as FormField } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { isRecipientEmail } from "@/admin-core/src/mail-delivery-test-recipient";

export type MailDeliveryTestDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (to: string) => void | Promise<void>;
};

export function MailDeliveryTestDialog({
  open,
  onOpenChange,
  onSubmit,
}: MailDeliveryTestDialogProps) {
  const [to, setTo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setTo("");
    setSubmitting(false);
  }, [open]);

  const recipient = to.trim();
  const canSend = isRecipientEmail(to);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="admin-dialog-surface">
        <DialogHeader>
          <DialogTitle>Send test email</DialogTitle>
          <DialogDescription>
            Send a test message through the configured platform delivery path. Acceptance by the
            transport does not mean the message reached an inbox.
          </DialogDescription>
        </DialogHeader>
        <FormField htmlFor="admin-mail-delivery-test-to" label="Recipient">
          <Input
            id="admin-mail-delivery-test-to"
            type="email"
            size="sm"
            autoComplete="email"
            value={to}
            onChange={(event) => {
              const value = event.target.value;
              setTo(value);
            }}
          />
        </FormField>
        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canSend || submitting}
            onClick={async () => {
              if (!canSend) return;
              setSubmitting(true);
              try {
                await onSubmit(recipient);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
