import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ChevronDown } from "lucide-react";
import type { MenuItemProps } from "@/menu-item/src/menu-item";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import type { DocsOutlineItem } from "@/docs-core/src/docs-outline";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import { cn } from "@/lib/utils";

import "@/docs-core/src/docs-outline-sidebar.css";

type DocsOutlineSidebarProps = {
  labels: DocsUILabels;
  items: DocsOutlineItem[];
  activeIndex: number | null;
  onSelect: (index: number) => void;
  /** Public share guests cannot navigate to docs home. */
  showBackToHome?: boolean;
  /** Headings only exist in Markdown; plain text files keep just the way back. */
  showOutline?: boolean;
};

const NO_ITEMS: MenuItemProps[] = [];

export function DocsOutlineSidebar({
  labels,
  items,
  activeIndex,
  onSelect,
  showBackToHome = true,
  showOutline = true,
}: DocsOutlineSidebarProps) {
  const navigate = useNavigate();

  const homeItems = useMemo(
    (): MenuItemProps[] => [
      {
        label: labels.sidebarBackToHome,
        icon: <ArrowLeft className="size-4" aria-hidden />,
        onClick: () => void navigate({ to: "/docs" }),
        className: "docs-outline-sidebar__back",
      },
    ],
    [labels.sidebarBackToHome, navigate],
  );

  const menuItems = useMemo((): MenuItemProps[] => {
    if (items.length === 0) {
      return [{ label: labels.outlineEmpty }];
    }

    // Tree look: depth from the shallowest heading; top rows get a fold chevron or a dot.
    const minLevel = Math.min(...items.map((item) => item.level));
    return items.map((item, index) => {
      const depth = Math.min(item.level - minLevel, 3);
      const next = items[index + 1];
      const hasChildren = next != null && next.level > item.level;
      const icon =
        depth > 0 ? undefined : hasChildren ? (
          <ChevronDown className="docs-outline-sidebar__chevron" aria-hidden />
        ) : (
          <span className="docs-outline-sidebar__dot" aria-hidden />
        );
      return {
        label: item.text,
        icon,
        selected: activeIndex === index,
        className: cn("docs-outline-sidebar__item", `docs-outline-sidebar__item--depth-${depth}`),
        onClick: () => onSelect(index),
      };
    });
  }, [activeIndex, items, labels.outlineEmpty, onSelect]);

  // First section: the way back to the documents. No Settings row here: Docs settings sit
  // on the documents list, one step back.
  const firstItems = showBackToHome ? homeItems : NO_ITEMS;

  return (
    <>
      {firstItems.length > 0 ? (
        <SidebarSection className="docs-outline-sidebar__first" items={firstItems} />
      ) : null}
      {showOutline ? <SidebarSection title={labels.sidebarOutline} items={menuItems} /> : null}
    </>
  );
}
