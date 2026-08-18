import { useId, useRef, useState, type ReactElement } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { nativeColorWellDismissProps } from "@/ui/dialog-nested-layer";
import { cn } from "@/lib/utils";
import "./swatch-color-picker.css";

export type SwatchColorPickerProps = {
  value: string;
  onChange: (color: string) => void;
  colorLabel: string;
  swatches: readonly string[];
  children: ReactElement;
};

export function SwatchColorPicker({
  value,
  onChange,
  colorLabel,
  swatches,
  children,
}: SwatchColorPickerProps) {
  const [open, setOpen] = useState(false);
  const customColorInputRef = useRef<HTMLInputElement>(null);
  const customColorInputId = useId();
  const colorLabelId = useId();

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent align="end" className="swatch-color-picker__content">
          <div
            className="swatch-color-picker__swatches"
            role="radiogroup"
            aria-labelledby={colorLabelId}
          >
            <span id={colorLabelId} className="sr-only">
              {colorLabel}
            </span>
            {swatches.map((swatch) => {
              const selected = value.toLowerCase() === swatch.toLowerCase();
              return (
                <button
                  key={swatch}
                  type="button"
                  className={cn(
                    "swatch-color-picker__swatch",
                    selected && "swatch-color-picker__swatch--selected",
                  )}
                  style={{ backgroundColor: swatch }}
                  aria-label={swatch}
                  aria-checked={selected}
                  role="radio"
                  onClick={() => {
                    onChange(swatch);
                    setOpen(false);
                  }}
                />
              );
            })}
            <button
              type="button"
              className="swatch-color-picker__swatch swatch-color-picker__swatch--custom"
              aria-label="Custom color"
              onClick={() => customColorInputRef.current?.click()}
            >
              <span className="swatch-color-picker__custom-marker" aria-hidden />
            </button>
          </div>
        </PopoverContent>
      </Popover>
      <input
        ref={customColorInputRef}
        id={customColorInputId}
        type="color"
        className="swatch-color-picker__native-color"
        value={value}
        tabIndex={-1}
        aria-hidden
        {...nativeColorWellDismissProps()}
        onChange={(event) => onChange(event.target.value)}
      />
    </>
  );
}
