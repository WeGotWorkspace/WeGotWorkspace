import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { IconButton } from "@/button/src/icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import "./settings-incoming-email-pane.css";

/** An ⓘ in a card header: background a pane does not need on the page itself. */
export function SettingsInfoButton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <IconButton
          label={label}
          icon={<Info aria-hidden />}
          variant="ghost"
          size="sm"
          showTooltip={false}
        />
      </TooltipTrigger>
      <TooltipContent className="settings-incoming-email__tooltip">{children}</TooltipContent>
    </Tooltip>
  );
}
