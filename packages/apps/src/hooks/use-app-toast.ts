import { createElement, useCallback } from "react";
import type { ReactNode } from "react";
import { toast as sonnerToast } from "sonner";
import type { CalloutSeverity } from "@/callout/src/callout";
import { workspaceAppLabelFromPath } from "@/lib/workspace-app-icons";
import { AppToastCallout } from "@/ui/app-toast-callout";

const DEFAULT_DURATION_MS = 4000;

/** Fills Sonner’s `[data-sonner-toaster]` width (`--width`); keep chrome inside {@link AppToastCallout}. */
const CUSTOM_TOAST_FRAME_CLASS =
  "w-full min-w-0 max-w-none !bg-transparent !p-0 !border-0 !shadow-none";

export type AppToastShowOptions = {
  severity?: CalloutSeverity;
  description?: ReactNode;
  duration?: number;
  icon?: ReactNode;
  /** When true with `onUndo`, renders an Undo control in the callout. */
  canUndo?: boolean;
  onUndo?: () => void;
  undoLabel?: string;
  /** When true with `onRetry`, renders a Retry control in the callout. */
  canRetry?: boolean;
  onRetry?: () => void;
  retryLabel?: string;
};

export type AppToastApi = {
  show: (title: string, options?: AppToastShowOptions) => string | number;
  dismiss: (id?: string | number) => string | number;
  showSuccess: (title: string, options?: Omit<AppToastShowOptions, "severity">) => string | number;
  showError: (title: string, options?: Omit<AppToastShowOptions, "severity">) => string | number;
};

/** Active suite app label — same path rule as the app-switch subtitle. */
function activeWorkspaceAppName(): string {
  if (typeof window === "undefined") return "Workspace";
  return workspaceAppLabelFromPath(window.location.pathname);
}

/**
 * App-wide toast surface: Sonner hosts {@link AppToastCallout} so toasts share
 * {@link Callout} spacing and optional undo. Chrome is generic (no accent /
 * severity color coding); the Callout title is the active suite app name.
 */
export function useAppToast(): AppToastApi {
  const show = useCallback((title: string, options?: AppToastShowOptions) => {
    const {
      severity = "info",
      description,
      duration = DEFAULT_DURATION_MS,
      icon,
      canUndo = false,
      onUndo,
      undoLabel,
      canRetry = false,
      onRetry,
      retryLabel,
    } = options ?? {};

    const showUndo = Boolean(canUndo && onUndo);
    const showRetry = Boolean(canRetry && onRetry);
    const appName = activeWorkspaceAppName();

    return sonnerToast.custom(
      (id) =>
        createElement(AppToastCallout, {
          toastId: id,
          appName,
          title,
          message: description,
          severity,
          icon,
          showUndo,
          onUndo,
          undoLabel,
          showRetry,
          onRetry,
          retryLabel,
        }),
      {
        duration,
        className: CUSTOM_TOAST_FRAME_CLASS,
        style: { width: "100%", maxWidth: "100%" },
        /** Aligns with default toaster position so Sonner’s height stack filter matches. */
        position: "bottom-right",
      },
    );
  }, []);

  const dismiss = useCallback((id?: string | number) => {
    return sonnerToast.dismiss(id);
  }, []);

  const showSuccess = useCallback(
    (title: string, options?: Omit<AppToastShowOptions, "severity">) => {
      return show(title, { ...options, severity: "success" });
    },
    [show],
  );

  const showError = useCallback(
    (title: string, options?: Omit<AppToastShowOptions, "severity">) => {
      return show(title, { ...options, severity: "error" });
    },
    [show],
  );

  return { show, dismiss, showSuccess, showError };
}
