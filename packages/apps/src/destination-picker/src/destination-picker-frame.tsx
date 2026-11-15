import type { KeyboardEventHandler, ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";
import { FieldLabelRow } from "@/ui/field-label-row";

type DestinationPickerFrameProps = {
  /** Caption of the path row ("Location"): a dialog row, path in the end column. */
  label: string;
  breadcrumbs: ReactNode;
  children: ReactNode;
  className?: string;
  /** Docs image-insert file-select: remap Drive green chrome to Docs tokens. */
  listingTheme?: "docs";
  /** The list's scroll box (keyboard focus moves within it). */
  bodyRef?: Ref<HTMLDivElement>;
  /** The list's keys (↑/↓, Enter, Alt+↑). */
  onBodyKeyDown?: KeyboardEventHandler<HTMLDivElement>;
};

export function DestinationPickerFrame({
  label,
  breadcrumbs,
  children,
  className,
  listingTheme,
  bodyRef,
  onBodyKeyDown,
}: DestinationPickerFrameProps) {
  return (
    <div className={cn("destination-picker", className)} data-drive-listing-theme={listingTheme}>
      <FieldLabelRow layout="inline" fill label={label} className="destination-picker__location">
        {breadcrumbs}
      </FieldLabelRow>
      <div ref={bodyRef} className="destination-picker__body" onKeyDown={onBodyKeyDown}>
        {children}
      </div>
    </div>
  );
}
