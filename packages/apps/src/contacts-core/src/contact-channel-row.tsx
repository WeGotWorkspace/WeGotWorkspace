import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { cn } from "@/lib/utils";

export type ContactChannelRowProps = {
  typeControl: ReactNode;
  children: ReactNode;
  removeLabel?: string;
  onRemove?: () => void;
  variant?: "default" | "address";
};

export function ContactChannelRow({
  typeControl,
  children,
  removeLabel,
  onRemove,
  variant = "default",
}: ContactChannelRowProps) {
  const isAddress = variant === "address";
  return (
    <div
      className={cn(
        "contacts-detail-view__channel-row",
        "contacts-detail-view__channel-row--editable",
        isAddress && "contacts-detail-view__channel-row--address",
      )}
    >
      <div className="contacts-detail-view__channel-type">{typeControl}</div>
      {children}
      <div
        className={cn(
          "contacts-detail-view__channel-action",
          isAddress && "contacts-detail-view__address-remove",
        )}
      >
        {onRemove ? (
          <IconButton
            label={removeLabel ?? ""}
            icon={<Trash2 className="size-4" aria-hidden />}
            variant="subtle"
            size="sm"
            onClick={onRemove}
          />
        ) : (
          <span className="contacts-detail-view__channel-action-spacer" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
