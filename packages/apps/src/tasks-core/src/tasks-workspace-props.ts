import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type {
  TasksAPIOperations,
  TaskProjectGroupOption,
  TasksUIData,
} from "@/tasks-core/src/tasks-types";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";

export type TasksWorkspaceProps = {
  data: TasksUIData;
  session: WorkspaceSession;
  labels?: Partial<TasksUILabels>;
  operations?: TasksAPIOperations;
  listRefreshing?: boolean;
  bootstrapRevision?: number;
  onRefreshList?: () => void;
  onLogout?: () => void;
  className?: string;
  initialView?: string;
  /** `?task=` deep-link — opens the edit dialog once the list is ready. */
  initialTaskId?: string;
  onViewChange?: (view: string) => void;
};

export function taskProjectGroupsFromBootstrap(data: TasksUIData): TaskProjectGroupOption[] {
  return data.groups ?? [];
}

export function personalOwnerLabel(session: WorkspaceSession): string {
  const displayName = session.user.displayName?.trim();
  if (displayName) return displayName;
  const username = session.user.username?.trim();
  if (username) return username;
  return "Me";
}
