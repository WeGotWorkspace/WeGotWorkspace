import type { ReactNode } from "react";
import { TooltipProvider } from "@/ui/tooltip";
import "@/settings-core/src/settings-workspace.css";

export function SettingsStoryScope({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={0}>
      <div className="settings-workspace settings-story-scope">
        <div className="mx-auto max-w-2xl p-6 md:p-10">{children}</div>
      </div>
    </TooltipProvider>
  );
}
