import { cn } from "@/lib/utils";

import "./content-label.css";

export type ContentLabelProps = {
  text: string;
  icon?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

/**
 * Compact rounded label for content metadata (mailbox, status, tags).
 */
export function ContentLabel({ text, icon, className, style }: ContentLabelProps) {
  return (
    <span
      className={cn("content-label", className)}
      style={{
        color: "var(--color-we-got-dark)",
        backgroundColor: "color-mix(in oklab, var(--color-we-got-dark) 8%, transparent)",
        ...style,
      }}
    >
      {icon ? <span className="shrink-0">{icon}</span> : null}
      <span className="truncate">{text}</span>
    </span>
  );
}
