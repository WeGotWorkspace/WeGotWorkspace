import type { ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/button/src/button";
import { Callout, type CalloutSeverity } from "@/callout/src/callout";

export type AppToastCalloutProps = {
  toastId: string | number;
  /** Active suite app label (Docs, Tasks, …) shown under the message. */
  appName: string;
  /** Primary toast body (main line above the app name). */
  title: string;
  message?: ReactNode;
  severity: CalloutSeverity;
  icon?: ReactNode;
  showUndo?: boolean;
  onUndo?: () => void;
  undoLabel?: string;
  showRetry?: boolean;
  onRetry?: () => void;
  retryLabel?: string;
};

export function AppToastCallout({
  toastId,
  appName,
  title,
  message,
  severity,
  icon,
  showUndo = false,
  onUndo,
  undoLabel = "Undo",
  showRetry = false,
  onRetry,
  retryLabel = "Retry",
}: AppToastCalloutProps) {
  const showAction = showUndo || showRetry;
  const actionLabel = showUndo ? undoLabel : retryLabel;
  const onAction = showUndo ? onUndo : onRetry;

  const body =
    message != null && message !== "" ? (
      <>
        <span className="app-toast-callout__title">{title}</span>
        <span className="app-toast-callout__detail">{message}</span>
      </>
    ) : (
      title
    );

  return (
    <Callout
      className="app-toast-callout w-full min-w-0"
      severity={severity}
      title={body}
      message={appName}
      icon={icon}
      action={
        showAction ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            label={actionLabel}
            onClick={() => {
              onAction?.();
              toast.dismiss(toastId);
            }}
          />
        ) : null
      }
    />
  );
}
