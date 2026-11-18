import { wgwFetch, wgwReadJson } from "@/lib/api/wgw/http";

/** `GET /tasks/items/{taskId}/text`, the task's live-text resource (#2208). */
export function taskTextPath(taskId: string): string {
  return `/tasks/items/${encodeURIComponent(taskId)}/text`;
}

/**
 * The collab room key of a task's live text (`task:<calendarid>:<uid>`). The
 * server names it, so a task id that is a file name maps to the room every
 * writer of that VTODO joins.
 */
export async function fetchTaskTextRoom(taskId: string): Promise<string> {
  const res = await wgwFetch(taskTextPath(taskId));
  if (!res.ok) throw new Error(`Could not open the task's text (${res.status})`);
  const data = (await wgwReadJson(res)) as { room?: unknown };
  if (typeof data.room !== "string" || data.room === "") {
    throw new Error("The task's text names no room");
  }
  return data.room;
}
