import { ListPlus } from "lucide-react";
import type { DropdownMenuItemProps } from "@/menu-dropdown/src/dropdown-menu";
import { SidebarSegmentedNewMenu } from "@/sidebar-segmented-new-menu/src/sidebar-segmented-new-menu";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";

export type TasksNewMenuProps = {
  labels: Pick<TasksUILabels, "newTask" | "newTaskMenu" | "addList">;
  onCreateTask: () => void;
  onCreateList?: () => void;
  disabled?: boolean;
};

export function TasksNewMenu({ labels, onCreateTask, onCreateList, disabled }: TasksNewMenuProps) {
  const items: DropdownMenuItemProps[] = [];
  if (onCreateList) {
    items.push({
      id: "create-list",
      label: labels.addList,
      icon: <ListPlus aria-hidden />,
      onClick: onCreateList,
    });
  }

  return (
    <SidebarSegmentedNewMenu
      mainLabel={labels.newTask}
      menuLabel={labels.newTaskMenu}
      onMainAction={onCreateTask}
      mainDisabled={disabled}
      items={items}
    />
  );
}
