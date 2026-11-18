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

/** ⌘Enter (Mac) or Ctrl+Enter sends; a plain Enter starts a new line (thread comments, #2173). */
export function shouldSendOnModEnter(event: ChatSendKeyEvent): boolean {
  if (event.key !== "Enter") return false;
  if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return false;
  if (event.isComposing || event.nativeEvent?.isComposing) return false;
  return true;
}
