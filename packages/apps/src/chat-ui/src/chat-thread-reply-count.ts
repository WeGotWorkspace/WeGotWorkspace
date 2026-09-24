export function chatThreadReplyCountLabel(count: number): string {
  if (count <= 0) return "No replies yet";
  if (count === 1) return "1 reply";
  return `${count} replies`;
}
