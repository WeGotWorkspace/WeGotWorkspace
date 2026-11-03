import { ChevronDown, ChevronUp } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Button, IconButton } from "@/button/src/button";
import { Callout } from "@/callout/src/callout";
import { cn } from "@/lib/utils";
import "@/notice-bar/src/notice-bar.css";

/** One place the notice can open straight at (for example a list with refused tasks). */
export type NoticeBarItem = {
  id: string;
  label: ReactNode;
  meta?: ReactNode;
  onAction: () => void;
};

/** Something waiting on the user. It stays until the app clears it, so it cannot be dismissed. */
export type Notice = {
  id: string;
  tone?: "warning" | "error" | "info";
  icon?: ReactNode;
  /** One sentence: what waits and where. */
  title: ReactNode;
  /** Few words for the folded dock pill, e.g. "5 tasks need a list". */
  short?: string;
  actionLabel: string;
  onAction: () => void;
  /** Per-place rows for the expandable and docked variants. */
  items?: NoticeBarItem[];
};

/**
 * Design options under review (2026-11): `strip` is one line under the header,
 * `expandable` adds one row per place, `dock` sits at the bottom of the pane
 * and folds down to a pill. The ones Wouter does not pick get removed.
 */
export type NoticeBarVariant = "strip" | "expandable" | "dock";

export type NoticeBarLabels = {
  /** Accessible name of the region, e.g. "Needs your attention". */
  region: string;
  showDetails: string;
  hideDetails: string;
  /** Folded dock pill when more than one notice waits, e.g. "2 things need you". */
  folded: (count: number) => string;
  fold: string;
};

export type NoticeBarProps = {
  notices: Notice[];
  labels: NoticeBarLabels;
  variant?: NoticeBarVariant;
  /** Per-row action label in the expandable and docked variants. */
  itemActionLabel?: string;
  /** Start folded (dock) or expanded (expandable); stories use it. */
  defaultOpen?: boolean;
  className?: string;
};

/**
 * Shared bar for things an app needs the user to settle, such as offline
 * changes the server refused. It sits between the main header and the
 * scrolling content, so it stays in view without being sticky itself.
 */
export function NoticeBar({
  notices,
  labels,
  variant = "strip",
  itemActionLabel,
  defaultOpen,
  className,
}: NoticeBarProps) {
  if (notices.length === 0) return null;
  return (
    <section
      className={cn("notice-bar", `notice-bar--${variant}`, className)}
      aria-label={labels.region}
      aria-live="polite"
    >
      {variant === "dock" ? (
        <NoticeDock
          notices={notices}
          labels={labels}
          itemActionLabel={itemActionLabel}
          defaultOpen={defaultOpen ?? true}
        />
      ) : (
        notices.map((notice) => (
          <NoticeRow
            key={notice.id}
            notice={notice}
            labels={labels}
            expandable={variant === "expandable"}
            itemActionLabel={itemActionLabel}
            defaultOpen={defaultOpen ?? false}
          />
        ))
      )}
    </section>
  );
}

type NoticeRowProps = {
  notice: Notice;
  labels: NoticeBarLabels;
  expandable: boolean;
  itemActionLabel?: string;
  defaultOpen: boolean;
};

function NoticeRow({ notice, labels, expandable, itemActionLabel, defaultOpen }: NoticeRowProps) {
  const [open, setOpen] = useState(defaultOpen);
  const itemsId = useId();
  const canExpand = expandable && (notice.items?.length ?? 0) > 1;
  return (
    <div className="notice-bar__notice">
      <Callout
        severity={notice.tone ?? "warning"}
        className="notice-bar__callout"
        icon={notice.icon ? <span className="callout__icon">{notice.icon}</span> : undefined}
        title={notice.title}
        action={
          <div className="notice-bar__actions">
            <Button
              label={notice.actionLabel}
              onClick={notice.onAction}
              variant="outline"
              size="sm"
            />
            {canExpand ? (
              <IconButton
                label={open ? labels.hideDetails : labels.showDetails}
                icon={open ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
                aria-controls={itemsId}
                variant="ghost"
                size="sm"
              />
            ) : null}
          </div>
        }
      />
      {canExpand && open ? (
        <NoticeItems id={itemsId} items={notice.items!} actionLabel={itemActionLabel} />
      ) : null}
    </div>
  );
}

function NoticeItems({
  id,
  items,
  actionLabel,
}: {
  id?: string;
  items: NoticeBarItem[];
  actionLabel?: string;
}) {
  return (
    <ul id={id} className="notice-bar__items">
      {items.map((item) => (
        <li key={item.id} className="notice-bar__item">
          <span className="notice-bar__item-label">{item.label}</span>
          {item.meta != null ? <span className="notice-bar__item-meta">{item.meta}</span> : null}
          <Button
            className="notice-bar__item-action"
            label={actionLabel}
            onClick={item.onAction}
            variant="ghost"
            size="sm"
          />
        </li>
      ))}
    </ul>
  );
}

type NoticeDockProps = {
  notices: Notice[];
  labels: NoticeBarLabels;
  itemActionLabel?: string;
  defaultOpen: boolean;
};

function NoticeDock({ notices, labels, itemActionLabel, defaultOpen }: NoticeDockProps) {
  const [open, setOpen] = useState(defaultOpen);
  if (!open) {
    return (
      <Button
        className="notice-bar__pill"
        label={
          notices.length === 1 && notices[0]?.short
            ? notices[0].short
            : labels.folded(notices.length)
        }
        icon={notices[0]?.icon}
        onClick={() => setOpen(true)}
        aria-expanded={false}
        variant="outline"
        size="md"
      />
    );
  }
  return (
    <div className="notice-bar__dock">
      {notices.map((notice) => (
        <div key={notice.id} className="notice-bar__notice">
          <Callout
            severity={notice.tone ?? "warning"}
            className="notice-bar__callout"
            icon={notice.icon ? <span className="callout__icon">{notice.icon}</span> : undefined}
            title={notice.title}
            action={
              <Button
                label={notice.actionLabel}
                onClick={notice.onAction}
                variant="outline"
                size="sm"
              />
            }
          />
          {(notice.items?.length ?? 0) > 1 ? (
            <NoticeItems items={notice.items!} actionLabel={itemActionLabel} />
          ) : null}
        </div>
      ))}
      <IconButton
        className="notice-bar__fold"
        label={labels.fold}
        icon={<ChevronDown aria-hidden />}
        onClick={() => setOpen(false)}
        aria-expanded
        variant="ghost"
        size="sm"
      />
    </div>
  );
}
