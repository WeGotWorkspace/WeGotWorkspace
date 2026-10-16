import { useCallback, useRef, useState, type ReactNode } from "react";

import { Button } from "@/button/src/button";
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

export type ConfirmDialogVariant = "default" | "destructive";

export type ConfirmDialogRequest = {
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  variant?: ConfirmDialogVariant;
  onConfirm: () => void;
};

/**
 * Controlled confirm pattern (title, description, labels, destructive styling).
 * Render `confirmDialog` once near the root of your screen; call `requestConfirm` to open.
 */
export function useConfirmDialog(options?: { contentClassName?: string }) {
  const [request, setRequest] = useState<ConfirmDialogRequest | null>(null);
  const suppressParentDismissRef = useRef(false);

  const dismiss = useCallback(() => {
    setRequest(null);
  }, []);

  const requestConfirm = useCallback((r: ConfirmDialogRequest) => {
    setRequest(r);
  }, []);

  const consumeParentDismissSuppression = useCallback(() => {
    if (!suppressParentDismissRef.current) return false;
    suppressParentDismissRef.current = false;
    return true;
  }, []);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        suppressParentDismissRef.current = true;
        dismiss();
      }
    },
    [dismiss],
  );

  const variant = request?.variant ?? "default";

  const confirmDialog = (
    <AlertDialog open={request !== null} onOpenChange={handleOpenChange}>
      {request ? (
        <AlertDialogContent className={options?.contentClassName}>
          <AlertDialogHeader>
            <AlertDialogTitle>{request.title}</AlertDialogTitle>
            <AlertDialogDescription>{request.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{request.cancelLabel}</AlertDialogCancel>
            <AlertDialogAction
              asChild
              onClick={() => {
                request.onConfirm();
                dismiss();
              }}
            >
              <Button variant={variant === "destructive" ? "destructive" : "primary"}>
                {request.confirmLabel}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      ) : null}
    </AlertDialog>
  );

  return { confirmDialog, requestConfirm, dismiss, consumeParentDismissSuppression };
}
