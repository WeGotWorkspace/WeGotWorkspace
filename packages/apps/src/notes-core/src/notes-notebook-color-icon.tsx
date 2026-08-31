import type { ReactElement } from "react";
import { Notebook } from "lucide-react";
import { cn } from "@/lib/utils";
import "@/notes-core/src/notes-notebook-color-icon.css";

/** Lucide notebook glyph tinted with `--collection-row-color` (same token as the old dots). */
export function NotesNotebookColorIcon({ className }: { className?: string }): ReactElement {
  return <Notebook className={cn("notes-notebook-color-icon", className)} aria-hidden />;
}
