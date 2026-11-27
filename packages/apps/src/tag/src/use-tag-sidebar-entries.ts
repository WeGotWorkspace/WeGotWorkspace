import { useMemo } from "react";
import type { TagSidebarEntry } from "@/tag/src/tag-sidebar-section";

/**
 * Sidebar entries for the tags in use: the one in `active` is selected; picking it again
 * clears the filter (`onPick(null)`), picking another filters on it. Shared by Drive and Docs.
 */
export function useTagSidebarEntries(
  tags: readonly string[],
  active: string | null,
  onPick: (tag: string | null) => void,
): TagSidebarEntry[] {
  return useMemo(
    () =>
      tags.map((tag) => ({
        tag,
        selected: active === tag,
        onSelect: () => onPick(active === tag ? null : tag),
      })),
    [active, onPick, tags],
  );
}
