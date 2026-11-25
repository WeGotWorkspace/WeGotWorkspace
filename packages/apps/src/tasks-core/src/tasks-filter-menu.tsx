import { ListFilter } from "lucide-react";
import { DropdownMenu, type DropdownMenuEntry } from "@/menu-dropdown/src/dropdown-menu";
import { IconButton } from "@/button/src/button";
import { workflowStatusIcon, workflowStatusLabel } from "@/tasks-core/src/tasks-workflow-status";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import {
  PRIORITY_FILTER_SLUGS,
  priorityFilterIcon,
  priorityFilterLabel,
  type PriorityFilterSlug,
} from "@/tasks-core/src/tasks-priority";
import { TASK_WORKFLOW_STATUSES, type TaskWorkflowStatus } from "@/tasks-core/src/tasks-task-utils";

export type TasksFilterMenuProps = {
  L: TasksUILabels;
  statusFilter: ReadonlySet<TaskWorkflowStatus>;
  priorityFilter: ReadonlySet<PriorityFilterSlug>;
  /** False on the status views, where the status segment would contradict the view. */
  statusApplies: boolean;
  onToggleStatus: (status: TaskWorkflowStatus) => void;
  onTogglePriority: (slug: PriorityFilterSlug) => void;
};

/**
 * The list header's filter: one icon button, a menu with two segments (Status, Priority) of
 * checkable rows. Rows toggle without closing the menu; a dot sits on the button while any
 * row is unchecked (the default hides completed and cancelled, so it starts with the dot).
 */
export function TasksFilterMenu({
  L,
  statusFilter,
  priorityFilter,
  statusApplies,
  onToggleStatus,
  onTogglePriority,
}: TasksFilterMenuProps) {
  const items: DropdownMenuEntry[] = [];
  if (statusApplies) {
    items.push({ type: "heading", id: "status-heading", label: L.sidebarStatus });
    for (const status of TASK_WORKFLOW_STATUSES) {
      items.push({
        id: `status:${status}`,
        label: workflowStatusLabel(status, L),
        icon: workflowStatusIcon(status),
        checked: statusFilter.has(status),
        keepOpen: true,
        onClick: () => onToggleStatus(status),
      });
    }
    items.push({ type: "separator", id: "filter-separator" });
  }
  items.push({ type: "heading", id: "priority-heading", label: L.sidebarPriority });
  for (const slug of PRIORITY_FILTER_SLUGS) {
    items.push({
      id: `priority:${slug}`,
      label: priorityFilterLabel(slug, L),
      icon: priorityFilterIcon(slug),
      checked: priorityFilter.has(slug),
      keepOpen: true,
      onClick: () => onTogglePriority(slug),
    });
  }
  // A dot while anything is unchecked: the list is narrower than everything.
  const filtered =
    (statusApplies && statusFilter.size < TASK_WORKFLOW_STATUSES.length) ||
    priorityFilter.size < PRIORITY_FILTER_SLUGS.length;
  return (
    <DropdownMenu
      align="end"
      items={items}
      trigger={
        <IconButton
          className="tasks-list-panel__filter"
          label={L.filterTasks}
          data-filtered={filtered ? "true" : undefined}
          icon={
            <span className="tasks-list-panel__filter-icon">
              <ListFilter className="size-4" aria-hidden />
              {filtered ? <span className="tasks-list-panel__filter-dot" aria-hidden /> : null}
            </span>
          }
          size="md"
          variant="outline"
        />
      }
    />
  );
}
