import type { LucideIcon } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { cn } from "@/lib/utils";

export type ShareRowSelectOption<T extends string> = {
  value: T;
  label: string;
  icon?: LucideIcon;
  muted?: boolean;
};

export type ShareRowSelectProps<T extends string> = {
  value: T;
  options: readonly ShareRowSelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  /** Compact toolbar/form rows; defaults to the shared md control. */
  size?: "sm" | "md";
  "aria-label"?: string;
};

export function ShareRowSelect<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  title,
  className,
  size = "md",
  "aria-label": ariaLabel,
}: ShareRowSelectProps<T>) {
  return (
    <Select value={value} disabled={disabled} onValueChange={(next) => onChange(next as T)}>
      <SelectTrigger
        size={size}
        className={className ?? "share-dialog__permission-select"}
        title={title}
        aria-label={ariaLabel}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => {
          const Icon = option.icon;
          return (
            <SelectItem key={option.value} value={option.value}>
              <span
                className={cn(
                  "share-dialog__permission-item",
                  option.muted && "text-muted-foreground",
                )}
              >
                {Icon ? <Icon className="share-dialog__permission-item-icon" aria-hidden /> : null}
                {option.label}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
