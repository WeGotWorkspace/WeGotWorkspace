import { useCallback, useEffect, useRef } from "react";
import type { Task, TaskList } from "@/lib/models/tasks-types";
import { parkTask } from "@/lib/offline/tasks/tasks-parked-writes";
import type { TextFieldsText } from "@/text-editor-core/docs-collab/docs-collab-text-fields";
import { useTaskTextCollab } from "@/tasks-core/src/use-task-text-collab";

/**
 * The open task's live text in the workspace (#2208): its room, the list row
 * projection, and the access-lost path. When the save is refused or the task
 * is gone while the room held text the server does not have, the task is
 * parked with that text for the rescue view (spec.md, Access loss).
 */
export function useTaskDetailLiveText({
  task,
  taskLists,
  username,
  displayName,
  showLiveText,
}: {
  task: Task | null;
  taskLists: TaskList[];
  username: string | undefined;
  displayName: string | undefined;
  showLiveText: (taskId: string, text: TextFieldsText) => void;
}) {
  const { collab, accessLost, lookingUp } = useTaskTextCollab({
    task: task ?? undefined,
    username,
    displayName,
  });
  /** The text the room last held, and whether the server has it. */
  const liveRef = useRef<{ taskId: string; text: TextFieldsText; unsaved: boolean } | null>(null);

  const onLiveText = useCallback(
    (taskId: string, text: TextFieldsText, unsaved: boolean) => {
      liveRef.current = { taskId, text, unsaved };
      showLiveText(taskId, text);
    },
    [showLiveText],
  );

  useEffect(() => {
    const live = liveRef.current;
    if (!accessLost || !username || !task || live?.taskId !== task.id || !live.unsaved) return;
    liveRef.current = null;
    const list = taskLists.find((entry) => entry.id === task.taskListId);
    void parkTask(
      username,
      { ...task, title: live.text.title, description: live.text.description },
      { kind: "edit", reason: "gone", containerName: list?.name ?? "" },
    ).catch(() => {});
  }, [accessLost, task, taskLists, username]);

  return {
    textCollab: collab,
    textAccessLost: accessLost,
    textLookingUp: lookingUp,
    onLiveText,
  };
}
