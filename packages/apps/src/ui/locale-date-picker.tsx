import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { Temporal } from "@js-temporal/polyfill";
import { Calendar } from "@/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { cn } from "@/lib/utils";
import { controlSizeClassName, type ControlSize } from "@/ui/control-size";

import "./input.css";
import "./locale-date-picker.css";

export type LocaleDatePickerProps = {
  value: string;
  locale: string;
  label: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
  /** Extra class for the portaled popover content. */
  popoverClassName?: string;
  /** Height, padding, and font-size. Default `md` = 36px. */
  size?: ControlSize;
};

function isoToJsDate(iso: string): Date | undefined {
  try {
    const plain = Temporal.PlainDate.from(iso);
    return new Date(plain.year, plain.month - 1, plain.day);
  } catch {
    return undefined;
  }
}

function jsDateToIso(date: Date): string {
  return Temporal.PlainDate.from({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  }).toString();
}

function formatDateLabel(iso: string, locale: string): string {
  try {
    return Temporal.PlainDate.from(iso).toLocaleString(locale, { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

/**
 * Locale-aware date field: Popover + Calendar, chrome from shared `.control-surface`
 * (same border / radius / height tokens as {@link Input} and {@link SelectTrigger}).
 */
export function LocaleDatePicker({
  value,
  locale,
  label,
  onChange,
  disabled = false,
  className,
  popoverClassName,
  size = "md",
}: LocaleDatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = isoToJsDate(value);
  const display = formatDateLabel(value, locale);

  return (
    <Popover open={disabled ? false : open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "control-surface locale-date-picker",
            controlSizeClassName("control-surface", size),
            className,
          )}
          aria-label={`${label}: ${display}`}
          lang={locale}
          disabled={disabled}
        >
          <span className="locale-date-picker__label">{display}</span>
          <CalendarDays className="locale-date-picker__icon" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn("locale-date-picker__popover w-auto p-0", popoverClassName)}
      >
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            if (!date) return;
            onChange(jsDateToIso(date));
            setOpen(false);
          }}
          formatters={{
            formatCaption: (date) =>
              date.toLocaleString(locale, { month: "long", year: "numeric" }),
            formatWeekdayName: (date) => date.toLocaleString(locale, { weekday: "short" }),
            formatMonthDropdown: (date) => date.toLocaleString(locale, { month: "short" }),
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
