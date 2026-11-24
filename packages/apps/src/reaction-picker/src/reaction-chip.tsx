import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Smile } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReactionPicker, type ReactionPickerProps } from "@/reaction-picker/src/reaction-picker";
import "@/reaction-picker/src/reaction-chip.css";

export type ReactionChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  emoji: string;
  count: number;
  /** Your own reaction: the ink as a hairline ring. */
  reacted: boolean;
};

/** One reaction on a message, comment or suggestion: emoji and count, a toggle. */
export const ReactionChip = forwardRef<HTMLButtonElement, ReactionChipProps>(function ReactionChip(
  { emoji, count, reacted, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn("reaction-chip", className)}
      data-reacted={reacted ? "true" : "false"}
      aria-pressed={reacted}
      {...rest}
    >
      <span className="reaction-chip__emoji" aria-hidden>
        {emoji}
      </span>
      <span className="reaction-chip__count">{count}</span>
    </button>
  );
});

export type ReactionAddPickerProps = Omit<ReactionPickerProps, "trigger"> & {
  /** Accessible name of the add button. */
  label: string;
};

/** The suite "add a reaction" control: the smile chip that opens the emoji picker. */
export function ReactionAddPicker({ label, ...picker }: ReactionAddPickerProps) {
  return (
    <ReactionPicker
      {...picker}
      trigger={
        <button
          type="button"
          className="reaction-chip reaction-chip--add"
          aria-label={label}
          onClick={(event) => event.stopPropagation()}
        >
          <Smile className="reaction-chip__add-icon" aria-hidden />
        </button>
      }
    />
  );
}
