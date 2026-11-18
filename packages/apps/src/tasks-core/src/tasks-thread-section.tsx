import type { Task } from "@/lib/models/tasks-types";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import { ThreadPanel } from "@/thread-ui/src/thread-panel";
import { useTaskThread } from "@/tasks-core/src/tasks-thread-adapter";

/** The task's comments under its fields (#2173). Readers without write access only read. */
export function TasksThreadSection({
  task,
  canPost,
  session,
}: {
  task: Pick<Task, "id" | "taskListId">;
  canPost: boolean;
  session: WorkspaceSession;
}) {
  const { client, adapter } = useTaskThread(task, canPost, session);
  return <ThreadPanel className="tasks-detail-view__thread" client={client} adapter={adapter} />;
}
