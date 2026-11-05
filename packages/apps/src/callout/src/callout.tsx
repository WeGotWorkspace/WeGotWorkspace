import { CircleAlert, CircleCheck, CircleX, Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { MenuItem } from "@/menu-item/src/menu-item";
import "@/callout/src/callout.css";

export type CalloutSeverity = "info" | "success" | "warning" | "error";

export type CalloutProps = {
  severity?: CalloutSeverity;
  title: ReactNode;
  message?: ReactNode;
  /** Use `className="callout__icon"` on Lucide (or similar) icons so severity tint applies. */
  icon?: ReactNode;
  /** Optional control (e.g. `Button`) aligned to the right, vertically centered with the content. */
  action?: ReactNode;
  /** Makes the content one button (a toast that opens what it is about). */
  onSelect?: () => void;
  className?: string;
};

function defaultIconForSeverity(severity: CalloutSeverity) {
  switch (severity) {
    case "success":
      return CircleCheck;
    case "warning":
      return CircleAlert;
    case "error":
      return CircleX;
    case "info":
    default:
      return Info;
  }
}

export function Callout({
  severity = "info",
  title,
  message,
  icon,
  action,
  onSelect,
  className,
}: CalloutProps) {
  const Icon = defaultIconForSeverity(severity);

  return (
    <div className={cn("callout", `callout--${severity}`, className)}>
      <div className="callout__body">
        <div className="callout__content">
          <MenuItem
            icon={icon ?? <Icon className="callout__icon" aria-hidden />}
            label={title}
            description={message}
            onClick={onSelect}
          />
        </div>
        {action != null ? <div className="callout__action">{action}</div> : null}
      </div>
    </div>
  );
}
