import { useCallback } from "react";
import { TagSidebarSection } from "@/tag/src/tag-sidebar-section";
import { useTagSidebarEntries } from "@/tag/src/use-tag-sidebar-entries";
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
  const pick = useCallback(
    (tag: string | null) => selectView(tag ? { type: "tag", tag } : { type: "all" }),
    [selectView],
  );
  const entries = useTagSidebarEntries(
    tags,
    view.type === "tag" ? view.tag.toLowerCase() : null,
    pick,
  );
  return <TagSidebarSection title={labels.sidebarTags} tags={entries} />;
}
