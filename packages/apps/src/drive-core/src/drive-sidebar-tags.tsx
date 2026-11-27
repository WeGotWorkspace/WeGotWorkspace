import { useMemo } from "react";
import { TagSidebarSection, type TagSidebarEntry } from "@/tag/src/tag-sidebar-section";
import { useFileTreeTags } from "@/lib/files/tree-view/use-file-tree-tags";
import type { ViewKey } from "@/lib/files/drive-models";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";

type DriveSidebarTagsProps = {
  username: string;
  labels: Pick<DriveUILabels, "sidebarTags">;
  view: ViewKey;
  selectView: (view: ViewKey) => void;
};

/** The Tags section of the Drive sidebar (#2402): picking a tag lists its items; picking it again goes back to All Files. */
export function DriveSidebarTags({ username, labels, view, selectView }: DriveSidebarTagsProps) {
  const tags = useFileTreeTags(username);
  const active = view.type === "tag" ? view.tag.toLowerCase() : null;
  const entries = useMemo(
    (): TagSidebarEntry[] =>
      tags.map((tag) => ({
        tag,
        selected: active === tag,
        onSelect: () => selectView(active === tag ? { type: "all" } : { type: "tag", tag }),
      })),
    [active, selectView, tags],
  );
  return <TagSidebarSection title={labels.sidebarTags} tags={entries} />;
}
