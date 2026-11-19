import type { ChatAuthorPresenceMap } from "@/lib/models/chat-types";
import { useAuthorPresence } from "@/presence-core/src/use-author-presence";

/** Live chat-author presence from the suite presence roster; see `useAuthorPresence`. */
export function useMeetAuthorPresence(): ChatAuthorPresenceMap | undefined {
  return useAuthorPresence();
}
