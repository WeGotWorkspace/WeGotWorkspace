import type { CSSProperties, ReactElement } from "react";
import { List } from "lucide-react";
import { cn } from "@/lib/utils";
import { taskListDotColor } from "@/tasks-core/src/tasks-task-utils";
import "@/tasks-core/src/tasks-list-icon.css";

type TaskListIconSource = {
  id: string;
  color?: string | null;
};

type TaskListIconProps = {
  list: string | TaskListIconSource;
  className?: string;
};

/** Lucide list glyph tinted with `--collection-row-color` (same token as Notes notebooks). */
export function TaskListIcon({ list, className }: TaskListIconProps): ReactElement {
  return (
    <List
      className={cn("tasks-list-icon", className)}
      style={{ "--collection-row-color": taskListDotColor(list) } as CSSProperties}
      aria-hidden
    />
  );
}
