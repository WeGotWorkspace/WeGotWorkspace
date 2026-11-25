import type { CSSProperties } from "react";
import { FolderKanban, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import "./project-mark.css";

/**
 * The Project icon on a wash of the Project's color: one look for Meet, Drive and Docs
 * (sidebar rows and headers). Without a color it sits on the neutral wash.
 */
export function ProjectMark({
  color,
  className,
  iconClassName = "size-3.5",
  icon: Icon = FolderKanban,
}: {
  color?: string | null;
  className?: string;
  iconClassName?: string;
  /** Glyph on the wash; defaults to the Project icon (Meet channels pass the hash). */
  icon?: LucideIcon;
}) {
  return (
    <span
      className={cn("project-mark", className)}
      style={color ? ({ "--project-mark-color": color } as CSSProperties) : undefined}
    >
      <Icon className={iconClassName} aria-hidden />
    </span>
  );
}
