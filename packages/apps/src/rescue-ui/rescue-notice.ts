import type { ParkedWrite } from "@/lib/offline/core/parked-writes";
import { groupParkedWrites } from "@/lib/offline/core/rescue-parked-writes";
import type { Notice } from "@/notice-bar/src/notice-bar";
import type { RescueContainer, RescueView } from "@/rescue-ui/rescue-adapter";

/**
 * The notice bar row while parked writes wait for a container (#1894), or
 * null when none wait. Review opens the rescue dialog.
 */
export function rescueNotice<C extends RescueContainer>(
  domain: string,
  view: Pick<RescueView<C>, "labels" | "noticeIcon">,
  writes: readonly ParkedWrite<unknown>[],
  onReview: () => void,
): Notice | null {
  const groups = groupParkedWrites([...writes]);
  if (groups.length === 0) return null;
  return {
    id: `rescue:${domain}`,
    tone: "warning",
    icon: view.noticeIcon,
    title: view.labels.notice(
      writes.length,
      groups.map((group) => group.containerName),
    ),
    actionLabel: view.labels.review,
    onAction: onReview,
  };
}
