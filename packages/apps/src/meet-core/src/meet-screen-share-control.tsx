import { useState } from "react";
import { MonitorUp } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { MenuItem } from "@/menu-item/src/menu-item";
import type { ScreenOptimize } from "@/meet-core/src/meet-video-sender";
import { meetLabels } from "@/meet-core/src/meet-labels";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import "@/menu-dropdown/src/dropdown-menu.css";

type MeetScreenShareControlProps = {
  screenOn: boolean;
  screenMode: ScreenOptimize;
  onStart: (mode: ScreenOptimize) => void;
  onOptimize: (mode: ScreenOptimize) => void;
  onStop: () => void;
};

const MODES: readonly ScreenOptimize[] = ["text", "video"];

function modeLabel(mode: ScreenOptimize): string {
  return mode === "video" ? meetLabels.optimizeForVideo : meetLabels.optimizeForText;
}

/**
 * Start a share in text or video mode, and switch that mode while the share
 * is already up. Switching does not call getDisplayMedia again.
 */
export function MeetScreenShareControl({
  screenOn,
  screenMode,
  onStart,
  onOptimize,
  onStop,
}: MeetScreenShareControlProps) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <IconButton
          icon={<MonitorUp />}
          label={screenOn ? meetLabels.stopSharing : meetLabels.shareScreen}
          size="md"
          variant="outline"
          active={screenOn || open}
          aria-pressed={screenOn}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="center" className="meet-device-menu">
        {MODES.map((mode) => {
          const active = screenOn && screenMode === mode;
          return (
            <DropdownMenuItem
              key={mode}
              asChild
              className="dropdown-menu__item"
              onSelect={() => (screenOn ? onOptimize(mode) : onStart(mode))}
            >
              <MenuItem
                label={modeLabel(mode)}
                checked={active}
                selected={active}
                className="dropdown-menu__menu-item"
                onClick={() => (screenOn ? onOptimize(mode) : onStart(mode))}
              />
            </DropdownMenuItem>
          );
        })}
        {screenOn ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="dropdown-menu__item" onSelect={onStop}>
              <MenuItem
                label={meetLabels.stopSharing}
                className="dropdown-menu__menu-item"
                onClick={onStop}
              />
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
