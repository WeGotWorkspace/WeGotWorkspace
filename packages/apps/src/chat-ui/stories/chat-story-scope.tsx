import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import "@/chat-ui/src/chat-ui.css";

export function ChatStoryScope({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("chat-ui chat-story-scope", className)}>{children}</div>;
}
