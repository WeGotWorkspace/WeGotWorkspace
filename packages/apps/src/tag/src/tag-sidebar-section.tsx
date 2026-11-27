import { Tag } from "@/tag/src/tag";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import type { ListDropZoneProps } from "@/hooks/use-sidebar-list-drag";
import { sidebarSelectMarker } from "@/workspace-shell/src/sidebar-breakpoint";
import { cn } from "@/lib/utils";
import "@/tag/src/tag-sidebar-section.css";

export type TagSidebarEntry = {
  tag: string;
  selected: boolean;
  onSelect: () => void;
} & Partial<ListDropZoneProps>;

type TagSidebarSectionProps = {
  title: string;
  tags: readonly TagSidebarEntry[];
  /** Extra classes on the section, row and item, for an app's own hooks. */
  className?: string;
  rowClassName?: string;
  itemClassName?: string;
};

/**
 * The sidebar's Tags section: the tags in use as wrapping `lg` chips; picking one filters
 * the list to it. Shared by Notes and Drive (and Docs, Tasks later): apps only declare the
 * tags and what a pick does.
 */
export function TagSidebarSection({
  title,
  tags,
  className,
  rowClassName,
  itemClassName,
}: TagSidebarSectionProps) {
  if (tags.length === 0) return null;
  return (
    <SidebarSection title={title} className={cn("tag-sidebar", className)}>
      {tags.map(({ tag, selected, onSelect, isDropTarget, ...dropHandlers }) => (
        <li key={tag} className={cn("tag-sidebar__row", rowClassName)}>
          <button
            type="button"
            {...sidebarSelectMarker}
            className={cn(
              "tag-sidebar__item",
              selected && "tag-sidebar__item--selected",
              isDropTarget && "tag-sidebar__item--drop-target",
              itemClassName,
            )}
            onClick={onSelect}
            aria-pressed={selected}
            {...dropHandlers}
          >
            <Tag label={tag} size="lg" />
          </button>
        </li>
      ))}
    </SidebarSection>
  );
}
