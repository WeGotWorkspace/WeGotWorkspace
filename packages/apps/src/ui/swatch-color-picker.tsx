import { useId, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import {
  nativeColorWellDismissProps,
  preventDialogDismissForNestedLayer,
} from "@/ui/dialog-nested-layer";
import { cn } from "@/lib/utils";
import "./swatch-color-picker.css";

export type SwatchColorPickerProps = {
  value: string;
  onChange: (color: string) => void;
  colorLabel: string;
  swatches: readonly string[];
  children: ReactElement;
};

function cssHexColor(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
}

export function SwatchColorPicker({
  value,
  onChange,
  colorLabel,
  swatches,
  children,
}: SwatchColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [customAnchor, setCustomAnchor] = useState<HTMLLabelElement | null>(null);
  const customColorInputRef = useRef<HTMLInputElement>(null);
  const customColorInputId = useId();
  const colorLabelId = useId();
  const selectedColor = cssHexColor(value);

  useLayoutEffect(() => {
    const input = customColorInputRef.current;
    if (!input) return;

    const clear = () => {
      input.style.left = "";
      input.style.top = "";
      input.style.width = "";
      input.style.height = "";
    };

    if (!open || !customAnchor) {
      clear();
      return;
    }

    const sync = () => {
      const rect = customAnchor.getBoundingClientRect();
      input.style.left = `${rect.left}px`;
      input.style.top = `${rect.top}px`;
      input.style.width = `${rect.width}px`;
      input.style.height = `${rect.height}px`;
    };

    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
      clear();
    };
  }, [customAnchor, open]);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent
          align="end"
          className="swatch-color-picker__content"
          onPointerDownOutside={preventDialogDismissForNestedLayer}
          onFocusOutside={preventDialogDismissForNestedLayer}
          onInteractOutside={preventDialogDismissForNestedLayer}
        >
          <div
            className="swatch-color-picker__swatches"
            role="radiogroup"
            aria-labelledby={colorLabelId}
          >
            <span id={colorLabelId} className="sr-only">
              {colorLabel}
            </span>
            {swatches.map((swatch) => {
              const selected = selectedColor.toLowerCase() === swatch.toLowerCase();
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
            <label
              ref={setCustomAnchor}
              htmlFor={customColorInputId}
              className="swatch-color-picker__swatch swatch-color-picker__swatch--custom"
            >
              <span className="swatch-color-picker__custom-marker" aria-hidden />
              <span className="sr-only">Custom color</span>
            </label>
          </div>
        </PopoverContent>
      </Popover>
      <input
        ref={customColorInputRef}
        id={customColorInputId}
        type="color"
        className="swatch-color-picker__native-color"
        value={selectedColor}
        data-open={open ? "true" : "false"}
        aria-label="Custom color"
        {...nativeColorWellDismissProps()}
        onChange={(event) => onChange(event.target.value)}
      />
    </>
  );
}
