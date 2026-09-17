/** Main-channel messages only. Replies already live in a thread. */
export function chatMessageCanOpenThread(message: {
  parentId?: string | null;
  threadId?: string | null;
}): boolean {
  return !message.parentId;
}

export function omitChatNestedThreadActions<T extends { id: string }>(
  actions: T[] | undefined,
): T[] | undefined {
  if (!actions) return undefined;
  const next = actions.filter((action) => action.id !== "reply");
  return next.length > 0 ? next : undefined;
}
