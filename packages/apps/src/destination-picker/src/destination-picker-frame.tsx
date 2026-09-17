import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type DestinationPickerFrameProps = {
  breadcrumbs: ReactNode;
  children: ReactNode;
  className?: string;
  /** Docs image-insert file-select: remap Drive green chrome to Docs tokens. */
  listingTheme?: "docs";
};

export function DestinationPickerFrame({
  breadcrumbs,
  children,
  className,
  listingTheme,
}: DestinationPickerFrameProps) {
  return (
    <div className={cn("destination-picker", className)} data-drive-listing-theme={listingTheme}>
      {breadcrumbs}
      <div className="destination-picker__body">{children}</div>
    </div>
  );
}
