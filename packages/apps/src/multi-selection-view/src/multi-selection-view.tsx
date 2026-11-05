import { CheckSquare2 } from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import type { ButtonSeverity, ButtonVariant } from "@/button/src/button.shared";
import { cn } from "@/lib/utils";
import "@/multi-selection-view/src/multi-selection-view.css";

export type MultiSelectionViewAction = {
  id?: string;
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  /** Destructive actions (trash / archive): danger fg + severity hover wash. */
  severity?: ButtonSeverity;
  /** Defaults to outline, like every other action (Done included). */
  variant?: ButtonVariant;
  /** Hairline before this control (typically Done). */
  separatorBefore?: boolean;
  /** A text button (its label, no icon) instead of an icon-only button (Done). */
  showLabel?: boolean;
};

export type MultiSelectionViewProps = {
  count: number;
  actions?: MultiSelectionViewAction[];
  className?: string;
  label?: string;
  title?: string | ((count: number) => string);
  icon?: React.ReactNode;
  /** `compact` fits a side panel: smaller ring, title and buttons. */
  size?: "default" | "compact";
};

function defaultTitle(count: number): string {
  return `${count} ${count === 1 ? "item" : "items"} selected`;
}

export function MultiSelectionView({
  count,
  actions = [],
  className,
  label = "Multiple selection",
  title = defaultTitle,
  icon,
  size = "default",
}: MultiSelectionViewProps) {
  const resolvedTitle = typeof title === "function" ? title(count) : title;
  const compact = size === "compact";

  return (
    <article
      className={cn(
        "multi-selection-view mx-auto flex max-w-[680px] flex-col items-center text-center",
        compact ? "multi-selection-view--compact pt-6" : "pt-12 md:pt-14",
        className,
      )}
    >
      <div
        className={cn(
          "multi-selection-view__icon-ring flex items-center justify-center rounded-full",
          compact ? "mb-4 size-14" : "mb-6 size-20",
        )}
      >
        {icon ?? <CheckSquare2 className={compact ? "size-6" : "size-9"} strokeWidth={1.5} />}
      </div>

      <div className="multi-selection-view__label">{label}</div>

      <h1
        className={cn(
          "multi-selection-view__title font-sans font-semibold leading-[1.1] tracking-tight",
          compact ? "text-xl" : "text-3xl md:text-4xl",
        )}
      >
        {resolvedTitle}
      </h1>

      {actions.length > 0 ? (
        <div className="multi-selection-view__actions mt-6 flex flex-wrap items-center justify-center gap-2">
          {actions.map((action) => (
            <span key={action.id ?? action.label} className="contents">
              {action.separatorBefore ? (
                <span className="multi-selection-view__spacer" aria-hidden />
              ) : null}
              {action.showLabel ? (
                <Button
                  label={action.label}
                  className="multi-selection-view__text-button"
                  onClick={action.onClick}
                  severity={action.severity}
                  icon={action.icon}
                  size={compact ? "lg" : "xl"}
                  variant={action.variant ?? "outline"}
                />
              ) : (
                <IconButton
                  label={action.label}
                  onClick={action.onClick}
                  active={action.active}
                  severity={action.severity}
                  icon={action.icon}
                  size={compact ? "lg" : "xl"}
                  variant={action.variant ?? "outline"}
                />
              )}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}
