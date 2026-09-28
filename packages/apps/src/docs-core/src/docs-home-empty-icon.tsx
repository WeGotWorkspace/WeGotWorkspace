import type { ReactNode } from "react";
import { Clock, Share, Star, Trash2 } from "lucide-react";
import type { DocsHomeEmptyIconKind } from "@/docs-core/src/docs-home-workspace-model";

/** Empty-state icon for the home list. `undefined` keeps the pane's document icon. */
export function docsHomeEmptyIcon(kind: DocsHomeEmptyIconKind | null): ReactNode {
  if (kind === "share") return <Share className="size-12" />;
  if (kind === "clock") return <Clock className="size-12" />;
  if (kind === "star") return <Star className="size-12" />;
  if (kind === "trash") return <Trash2 className="size-12" />;
  return undefined;
}
