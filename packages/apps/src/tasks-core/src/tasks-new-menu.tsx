import { ListPlus, Upload } from "lucide-react";
import type { DropdownMenuItemProps } from "@/menu-dropdown/src/dropdown-menu";
import { SidebarSegmentedNewMenu } from "@/sidebar-segmented-new-menu/src/sidebar-segmented-new-menu";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";

export type TasksNewMenuProps = {
  labels: Pick<
    TasksUILabels,
    "newTask" | "newTaskMenu" | "addList" | "importTasks" | "importTasksOffline"
  >;
  onCreateTask: () => void;
  onCreateList?: () => void;
  /** Opens the `.ics` file picker; omit when import is not available. */
  onImportTasks?: () => void;
  /** Import needs the server; offline the item stays visible but disabled. */
  importOffline?: boolean;
  disabled?: boolean;
};

export function TasksNewMenu({
  labels,
  onCreateTask,
  onCreateList,
  onImportTasks,
  importOffline = false,
  disabled,
}: TasksNewMenuProps) {
  const items: DropdownMenuItemProps[] = [];
  if (onCreateList) {
    items.push({
      id: "create-list",
      label: labels.addList,
      icon: <ListPlus aria-hidden />,
      onClick: onCreateList,
    });
  }
  if (onImportTasks) {
    items.push({
      id: "import-tasks",
      label: labels.importTasks,
      icon: <Upload aria-hidden />,
      onClick: onImportTasks,
      disabled: importOffline,
      ...(importOffline ? { description: labels.importTasksOffline } : {}),
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
