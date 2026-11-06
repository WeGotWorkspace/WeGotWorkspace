import type { ReactNode } from "react";
import "../src/tasks-field-controls.css";
import "../src/tasks-workspace.css";

export type TasksStoryScopeVariant = "app" | "main";

export function TasksStoryScope({
  children,
  variant = "app",
}: {
  children: ReactNode;
  variant?: TasksStoryScopeVariant;
}) {
  if (variant === "main") {
    return (
      <div className="tasks-workspace tasks-story-scope tasks-story-scope--main">
        <div className="mx-auto flex h-dvh w-full max-w-2xl flex-col">{children}</div>
      </div>
    );
  }

  return (
    <div className="tasks-workspace tasks-story-scope">
      <div className="h-dvh w-full">{children}</div>
    </div>
  );
}
