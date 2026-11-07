import { useState, type ReactNode } from "react";
import { IconButton } from "@/button/src/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { REACTION_EMOJIS } from "@/reaction-picker/src/reaction-emojis";
import "@/reaction-picker/src/reaction-picker.css";

export { REACTION_EMOJIS };

export type ReactionPickerProps = {
  /** The control that opens the picker (rendered `asChild`). */
  trigger: ReactNode;
  /** Already reacted with this emoji: the button shows pressed. */
  isPicked: (emoji: string) => boolean;
  onPick: (emoji: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  emojis?: readonly string[];
};

/**
 * Emoji picker: the suite floating toolbar (`lg` outline icon buttons) in a
 * popover, like the chat message hover actions it opens from. Closes on pick.
 */
export function ReactionPicker({
  trigger,
  isPicked,
  onPick,
  open: openProp,
  onOpenChange,
  side = "top",
  align = "start",
  sideOffset = 4,
  emojis = REACTION_EMOJIS,
}: ReactionPickerProps) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        frost
        className="reaction-picker"
      >
        {emojis.map((emoji) => {
          const picked = isPicked(emoji);
          return (
            <IconButton
              key={emoji}
              className="reaction-picker__item"
              label={emoji}
              showTooltip={false}
              icon={<span aria-hidden>{emoji}</span>}
              size="lg"
              variant="outline"
              active={picked}
              aria-pressed={picked}
              onClick={(event) => {
                event.stopPropagation();
                onPick(emoji);
                setOpen(false);
              }}
            />
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
