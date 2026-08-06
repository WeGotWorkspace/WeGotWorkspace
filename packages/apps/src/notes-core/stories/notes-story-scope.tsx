import type { ReactNode } from "react";
import "@/notes-core/src/notes-workspace.css";

export type NotesStoryScopeVariant = "pane" | "list-column" | "detail";

export function NotesStoryScope({
  children,
  variant = "pane",
}: {
  children: ReactNode;
  variant?: NotesStoryScopeVariant;
}) {
  if (variant === "list-column") {
    return (
      <div className="notes-workspace notes-story-scope notes-story-scope--list-column">
        <div className="h-dvh w-full max-w-md shrink-0 md:w-96">{children}</div>
      </div>
    );
  }

  if (variant === "detail") {
    return (
      <div className="notes-workspace notes-story-scope notes-story-scope--detail">
        <div className="mx-auto max-w-3xl px-6 pt-6 pb-10 md:px-12 md:pt-12 md:pb-16">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="notes-workspace notes-story-scope">
      <div className="mx-auto max-w-2xl p-6 md:p-10">{children}</div>
    </div>
  );
}
