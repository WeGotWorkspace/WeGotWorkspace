import type { ReactNode } from "react";
import { Button } from "@/button/src/button";
import { Callout } from "@/callout/src/callout";
import { cn } from "@/lib/utils";
import "@/notice-bar/src/notice-bar.css";

/** The button that settles a notice. Label and handler come together or not at all. */
type NoticeAction =
  | {
      actionLabel: string;
      onAction: () => void;
      /** While the action runs (e.g. a retry in flight). */
      actionDisabled?: boolean;
    }
  | {
      /** An `info` notice can just state something (e.g. offline data age). */
      actionLabel?: undefined;
      onAction?: undefined;
      actionDisabled?: undefined;
    };

/** Something the user should know. It stays until the app clears it, so it cannot be dismissed. */
export type Notice = {
  id: string;
  tone?: "warning" | "error" | "info";
  icon?: ReactNode;
  /** One sentence: what waits and where. */
  title: ReactNode;
} & NoticeAction;

/** A notice that always has its settle button (sync retry, rescue). */
export type ActionNotice = Notice & { actionLabel: string; onAction: () => void };

export type NoticeBarProps = {
  notices: readonly (Notice | null | undefined)[];
  /** Accessible name of the region, from the app, e.g. "Needs your attention". */
  label: string;
  className?: string;
};

/**
 * Shared bar for things an app needs the user to settle, such as changes that
 * could not sync or offline changes the server refused (#1894). The host
 * layout places it between the main header and the scrolling content, so it
 * stays in view without being sticky itself. Notices stack in the given order.
 */
export function NoticeBar({ notices, label, className }: NoticeBarProps) {
  const shown = notices.filter((notice): notice is Notice => notice != null);
  if (shown.length === 0) return null;
  return (
    <section className={cn("notice-bar", className)} aria-label={label} aria-live="polite">
      {shown.map((notice) => (
        <div key={notice.id} className="notice-bar__notice">
          <Callout
            severity={notice.tone ?? "warning"}
            className="notice-bar__callout"
            icon={notice.icon}
            title={notice.title}
            action={
              notice.actionLabel !== undefined ? (
                <Button
                  label={notice.actionLabel}
                  onClick={notice.onAction}
                  disabled={notice.actionDisabled}
                  variant="outline"
                  size="sm"
                />
              ) : undefined
            }
          />
        </div>
      ))}
    </section>
  );
}
