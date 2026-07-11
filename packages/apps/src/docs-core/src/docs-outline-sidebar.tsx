import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { MenuItemProps } from "@/menu-item/src/menu-item";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { formatOutlineNumbers, type DocsOutlineItem } from "@/docs-core/src/docs-outline";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";

import "@/docs-core/src/docs-outline-sidebar.css";

type DocsOutlineSidebarProps = {
  labels: DocsUILabels;
  items: DocsOutlineItem[];
  activeIndex: number | null;
  onSelect: (index: number) => void;
  /** Public share guests cannot navigate to docs home. */
  showBackToHome?: boolean;
};

export function DocsOutlineSidebar({
  labels,
  items,
  activeIndex,
  onSelect,
  showBackToHome = true,
}: DocsOutlineSidebarProps) {
  const navigate = useNavigate();

  const homeItems = useMemo(
    (): MenuItemProps[] => [
      {
        label: labels.sidebarBackToHome,
        icon: <ArrowLeft className="size-4" aria-hidden />,
        onClick: () => void navigate({ to: "/docs" }),
      },
    ],
    [labels.sidebarBackToHome, navigate],
  );

  const menuItems = useMemo((): MenuItemProps[] => {
    if (items.length === 0) {
      return [{ label: labels.outlineEmpty }];
    }

    const numbers = formatOutlineNumbers(items);
    return items.map((item, index) => ({
      label: item.text,
      icon: <span className="docs-outline-sidebar__number">{numbers[index]}</span>,
      selected: activeIndex === index,
      onClick: () => onSelect(index),
    }));
  }, [activeIndex, items, labels.outlineEmpty, onSelect]);

  return (
    <>
      {showBackToHome ? <SidebarSection items={homeItems} /> : null}
      <SidebarSection title={labels.sidebarOutline} items={menuItems} />
    </>
  );
}
