import { useCallback } from "react";
import { TagSidebarSection } from "@/tag/src/tag-sidebar-section";
import { useTagSidebarEntries } from "@/tag/src/use-tag-sidebar-entries";
import { useFileTreeTags } from "@/lib/files/tree-view/use-file-tree-tags";
import type { FileTreeEntryFilter } from "@/lib/files/tree-view/tree-view-predicates";
import type { DocsHomeView } from "@/docs-core/src/docs-home-shared";

type DocsSidebarTagsProps = {
  username: string;
  title: string;
  /** What Docs lists, so only tags of those files are offered. */
  entryFilter?: FileTreeEntryFilter;
  view: DocsHomeView;
  selectView: (view: DocsHomeView) => void;
};

/** The Tags section of the Docs sidebar (#2402): the same tags and filter as Drive, narrowed to Docs files. */
export function DocsSidebarTags({
  username,
  title,
  entryFilter,
  view,
  selectView,
}: DocsSidebarTagsProps) {
  const tags = useFileTreeTags(username, entryFilter);
  const pick = useCallback(
    (tag: string | null) => selectView(tag ? { type: "tag", tag } : { type: "all" }),
    [selectView],
  );
  const entries = useTagSidebarEntries(
    tags,
    view.type === "tag" ? view.tag.toLowerCase() : null,
    pick,
  );
  return <TagSidebarSection title={title} tags={entries} />;
}
