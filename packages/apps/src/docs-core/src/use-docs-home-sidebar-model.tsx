import { useMemo } from "react";
import { Files, HardDrive, Share2, Users } from "lucide-react";
import type { MenuItemProps } from "@/menu-item/src/menu-item";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import type { DocsHomeDrive } from "@/docs-core/src/docs-home-drives";
import type { DocsHomeView } from "@/docs-core/src/docs-home-shared";

type UseDocsHomeSidebarModelArgs = {
  labels: DocsUILabels;
  drives: DocsHomeDrive[];
  view: DocsHomeView;
  selectView: (view: DocsHomeView) => void;
};

export function useDocsHomeSidebarModel({
  labels,
  drives,
  view,
  selectView,
}: UseDocsHomeSidebarModelArgs) {
  const primaryItems = useMemo<MenuItemProps[]>(
    () => [
      {
        label: labels.homeAllDocs,
        icon: <Files className="size-3.5" />,
        selected: view.type === "all",
        onClick: () => selectView({ type: "all" }),
      },
      {
        label: labels.homeSharedWithMe,
        icon: <Share2 className="size-3.5" />,
        selected: view.type === "shared",
        onClick: () => selectView({ type: "shared" }),
      },
    ],
    [labels.homeAllDocs, labels.homeSharedWithMe, selectView, view.type],
  );

  const driveItems = useMemo<MenuItemProps[]>(
    () =>
      drives.map((drive) => ({
        label: drive.label,
        icon: drive.pathPrefix.startsWith("users/") ? (
          <HardDrive className="size-3.5" />
        ) : (
          <Users className="size-3.5" />
        ),
        selected: view.type === "drive" && view.pathPrefix === drive.pathPrefix,
        onClick: () => selectView({ type: "drive", pathPrefix: drive.pathPrefix }),
      })),
    [drives, selectView, view],
  );

  return { primaryItems, driveItems };
}
