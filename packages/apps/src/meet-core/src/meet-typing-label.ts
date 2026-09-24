import { meetLabels } from "@/meet-core/src/meet-labels";

/** "Alice is typing…" row text for a channel; null when nobody is typing. */
export function meetTypingLabel(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return meetLabels.typingOne(names[0]!);
  if (names.length === 2) return meetLabels.typingTwo(names[0]!, names[1]!);
  return meetLabels.typingMany(names.length);
}
