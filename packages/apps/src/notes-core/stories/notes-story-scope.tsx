import type { CSSProperties, ReactNode } from "react";
import "@/notes-core/src/notes-workspace.css";

export type NotesStoryScopeVariant = "pane" | "list-column" | "detail";

export function NotesStoryScope({
  children,
  variant = "pane",
  detailTint,
}: {
  children: ReactNode;
  variant?: NotesStoryScopeVariant;
  /** Runtime notebook color for `--notes-detail-tint` (empty/unset stays cream). */
  detailTint?: string;
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
      <div
        className="notes-workspace notes-story-scope notes-story-scope--detail"
        style={detailTint ? ({ ["--notes-detail-tint"]: detailTint } as CSSProperties) : undefined}
      >
        {children}
      </div>
    );
  }

  return (
    <div className="notes-workspace notes-story-scope">
      <div className="mx-auto max-w-2xl p-6 md:p-10">{children}</div>
    </div>
  );
}
