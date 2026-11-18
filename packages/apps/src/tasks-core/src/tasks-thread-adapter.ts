import { useEffect, useMemo, useState } from "react";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { listTaskListMembers } from "@/lib/api/wgw/tasks";
import { liveThreadClient } from "@/lib/api/wgw/threads";
import type { Task } from "@/lib/models/tasks-types";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import { createThreadMemoryClient } from "@/thread-ui/src/thread-memory-client";
import type { ThreadClient, ThreadPerson, ThreadSubjectAdapter } from "@/lib/models/thread-types";

/** The server's subject type for task threads (#2173, `TaskThreadSubject::TYPE`). */
export const TASK_THREAD_TYPE = "task";

let mockClient: ThreadClient | null = null;

/** Live API, or one in-memory thread store for mock mode. */
export function taskThreadClient(): ThreadClient {
  if (wgwLiveApiEnabled()) return liveThreadClient;
  mockClient ??= createThreadMemoryClient();
  return mockClient;
}

export function sessionPerson(session: WorkspaceSession): ThreadPerson {
  const id = session.user.username?.trim() || "demo";
  return { id, displayName: session.user.displayName?.trim() || id };
}

/**
 * The task's thread as the shared panel needs it: the task as subject, its
 * list as scope (sent with each post, so a stale view answers `subject_moved`),
 * write access from the list, and the list's people for mentions.
 */
export function taskThreadAdapter(
  task: Pick<Task, "id" | "taskListId">,
  canPost: boolean,
  me: ThreadPerson,
  people: readonly ThreadPerson[],
): ThreadSubjectAdapter {
  return {
    subject: { type: TASK_THREAD_TYPE, id: task.id },
    scopeId: task.taskListId,
    canPost,
    people,
    me,
  };
}

/** The list's people (live: the members route; mock: just the user). */
export function useTaskListPeople(taskListId: string, me: ThreadPerson): readonly ThreadPerson[] {
  const [people, setPeople] = useState<readonly ThreadPerson[]>([me]);
  useEffect(() => {
    setPeople([me]);
    if (!wgwLiveApiEnabled()) return undefined;
    const controller = new AbortController();
    listTaskListMembers(taskListId, { signal: controller.signal })
      .then((members) => {
        if (controller.signal.aborted) return;
        setPeople(
          members.map((member) => ({ id: member.username, displayName: member.displayName })),
        );
      })
      .catch(() => {
        // Mentions fall back to no one but the user; the thread itself still loads.
      });
    return () => controller.abort();
  }, [taskListId, me]);
  return people;
}

/** Everything `ThreadPanel` needs for one open task. */
export function useTaskThread(
  task: Pick<Task, "id" | "taskListId">,
  canPost: boolean,
  session: WorkspaceSession,
): { client: ThreadClient; adapter: ThreadSubjectAdapter } {
  const me = useMemo(() => sessionPerson(session), [session]);
  const people = useTaskListPeople(task.taskListId, me);
  const adapter = useMemo(
    () => taskThreadAdapter(task, canPost, me, people),
    [task.id, task.taskListId, canPost, me, people], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return { client: taskThreadClient(), adapter };
}
