import { useEffect, useState, type TransitionEvent } from "react";
import { IconButton } from "@/button/src/button";
import type { ButtonSeverity } from "@/button/src/button.shared";
import { cn } from "@/lib/utils";
import "@/floating-action-bar/src/floating-action-bar.css";

export type FloatingActionBarButton = {
  id?: string;
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  /** Destructive actions (trash / archive): danger fg + severity hover wash. */
  severity?: ButtonSeverity;
  /** Visual hairline before this control (typically Done). */
  separatorBefore?: boolean;
};

type FloatingActionBarProps = {
  items: number;
  buttons: FloatingActionBarButton[];
  children?: React.ReactNode;
  className?: string;
  /**
   * When false, plays the exit slide then unmounts. Defaults to true for
   * Storybook / direct mounts that always show the bar.
   */
  open?: boolean;
};

function selectionCountLabel(items: number): string {
  return items === 1 ? "1 Item" : `${items} Items`;
}

export function FloatingActionBar({
  items,
  buttons,
  children,
  className,
  open = true,
}: FloatingActionBarProps) {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  const handleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.propertyName !== "opacity" && event.propertyName !== "transform") return;
    if (!open) setMounted(false);
  };

  if (!mounted) return null;

  return (
    <div
      className={cn("floating-action-bar", className)}
      role="toolbar"
      aria-label="Selection actions"
      data-state={open ? "open" : "closed"}
      onTransitionEnd={handleTransitionEnd}
    >
      <span className="floating-action-bar__count">{selectionCountLabel(items)}</span>
      <div className="floating-action-bar__actions">
        {buttons.map((button) => (
          <span key={button.id ?? button.label} className="contents">
            {button.separatorBefore ? (
              <span className="floating-action-bar__spacer" aria-hidden />
            ) : null}
            <IconButton
              label={button.label}
              icon={button.icon}
              onClick={button.onClick}
              active={button.active}
              severity={button.severity}
              size="sm"
              variant="outline"
            />
          </span>
        ))}
        {children}
      </div>
    </div>
  );
}
