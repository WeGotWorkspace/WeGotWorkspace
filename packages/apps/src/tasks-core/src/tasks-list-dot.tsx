import { taskListDotColor } from "@/tasks-core/src/tasks-task-utils";
import "./tasks-list-dot.css";

type TaskListDotSource = {
  id: string;
  color?: string | null;
};

type TaskListDotProps = {
  list: string | TaskListDotSource;
  className?: string;
};

export function TaskListDot({ list, className }: TaskListDotProps) {
  return (
    <span
      className={className ? `tasks-list-dot ${className}` : "tasks-list-dot"}
      style={{ backgroundColor: taskListDotColor(list) }}
      aria-hidden
    />
  );
}
