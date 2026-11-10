import { useEffect, useRef } from "react";
import { publishElementHeight } from "@/lib/publish-element-height";

/**
 * The composer floats over the messages as frosted chrome. This publishes its
 * height as `--chat-dock-height` on the host, so the message scroller keeps its
 * last line clear of it.
 */
export function useChatDock<Host extends HTMLElement, Dock extends HTMLElement>() {
  const hostRef = useRef<Host>(null);
  const dockRef = useRef<Dock>(null);
  useEffect(() => publishElementHeight(hostRef.current, dockRef.current, "--chat-dock-height"), []);
  return { hostRef, dockRef };
}
