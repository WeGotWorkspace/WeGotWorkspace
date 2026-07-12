import { Tag } from "@/tag/src/tag";
import { shareLabels } from "@/share-ui/share-labels";

export function SharePendingTag() {
  return <Tag label={shareLabels.pendingGuest} />;
}
