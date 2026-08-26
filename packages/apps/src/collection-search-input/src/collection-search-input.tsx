import type { RefObject } from "react";

import { Input } from "@/ui/input";
import { cn } from "@/lib/utils";

import "./collection-search-input.css";

type CollectionSearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  className?: string;
  /** When false, Escape is left for a parent dialog/popover to dismiss. Default true. */
  clearOnEscape?: boolean;
};

export function CollectionSearchInput({
  value,
  onChange,
  placeholder,
  inputRef,
  className,
  clearOnEscape = true,
}: CollectionSearchInputProps) {
  return (
    <Input
      ref={inputRef}
      variant="search"
      size="sm"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className={cn("collection-search-input", className)}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !clearOnEscape) return;
        event.preventDefault();
        onChange("");
        event.currentTarget.blur();
      }}
    />
  );
}
