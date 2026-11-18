export type ChatSendKeyEvent = {
  key: string;
  shiftKey: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean };
};

/** Enter sends; Shift+Enter (and IME compose) stay in the draft. */
export function shouldSendChatOnEnter(event: ChatSendKeyEvent): boolean {
  if (event.key !== "Enter") return false;
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
  if (event.isComposing || event.nativeEvent?.isComposing) return false;
  return true;
}
