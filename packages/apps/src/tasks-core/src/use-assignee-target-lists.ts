import { useEffect, useMemo, useRef, useState } from "react";
import type { TaskList, TaskListMember, TaskListMembersResult } from "@/lib/models/tasks-types";
import { canWriteTaskList } from "@/lib/models/task-lists";

/** A list a task for this person can be created in: you can write to it and so can they. */
export type AssigneeTargetList = {
  id: string;
  name: string;
  color?: string | null;
  /** The person as that list's audience knows them (the assignee entry is built from it). */
  member: TaskListMember;
};

/**
 * The lists to offer when creating a task from a colleague's "Assigned to" view: the lists
 * (in sidebar order) you can write to whose audience holds that person with write access.
 * The audiences load once per list while the view is open.
 */
export function useAssigneeTargetLists({
  username,
  lists,
  loadMembers,
}: {
  /** The colleague, or null outside an assignee view (nothing loads then). */
  username: string | null;
  lists: readonly Pick<TaskList, "id" | "name" | "color" | "myRights">[];
  loadMembers?: (taskListId: string) => Promise<TaskListMembersResult>;
}): { options: AssigneeTargetList[]; loading: boolean } {
  // list id -> that list's loaded audience. A list with no entry is unknown (not asked yet, or
  // the load failed or had no answer), which is not the same as "this person is not on it".
  const [audiences, setAudiences] = useState<ReadonlyMap<string, TaskListMember[]>>(
    () => new Map(),
  );
  const asked = useRef(new Set<string>());
  const [online, setOnline] = useState(0);
  const writable = useMemo(() => lists.filter((list) => canWriteTaskList(list)), [lists]);

  // Back online: ask again for the lists that never answered.
  useEffect(() => {
    const retry = () => setOnline((count) => count + 1);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);

  useEffect(() => {
    if (username === null || !loadMembers) return;
    for (const list of writable) {
      if (asked.current.has(list.id)) continue;
      asked.current.add(list.id);
      loadMembers(list.id)
        .then((result) => {
          if (result.members) {
            const members = result.members;
            setAudiences((previous) => new Map(previous).set(list.id, members));
          } else {
            asked.current.delete(list.id);
          }
        })
        .catch(() => asked.current.delete(list.id));
    }
  }, [loadMembers, username, writable, online]);

  const options = useMemo(() => {
    if (username === null) return [];
    const wanted = username.toLowerCase();
    return writable.flatMap((list): AssigneeTargetList[] => {
      const member = audiences
        .get(list.id)
        ?.find((candidate) => candidate.username.toLowerCase() === wanted);
      if (!member || member.access !== "write") return [];
      return [{ id: list.id, name: list.name, color: list.color, member }];
    });
  }, [audiences, username, writable]);

  const loading =
    username !== null &&
    loadMembers !== undefined &&
    writable.some((list) => !audiences.has(list.id));
  return { options, loading };
}
