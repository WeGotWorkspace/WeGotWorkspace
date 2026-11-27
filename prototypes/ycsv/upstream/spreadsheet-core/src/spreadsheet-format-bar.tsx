import { type ReactNode } from "react";
import { Bold, Square, PaintBucket } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import type { SelectionStyleState } from "@/spreadsheet-core/src/spreadsheet-cell-styles";
import type { SpreadsheetUILabels } from "@/spreadsheet-core/src/spreadsheet-labels";
import "@/text-editor-core/src/text-editor.css";

const FILL_SWATCHES = [
  "#ffffff",
  "#f5f5f5",
  "#fff3cd",
  "#fce4e4",
  "#e6f7f5",
  "#dbeafe",
  "#f3e8ff",
] as const;

function FormatBarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active ? true : undefined}
      className={cn("text-editor-format-bar__btn", active && "text-editor-format-bar__btn--active")}
    >
      <span className="text-editor-format-bar__btn-icon">{children}</span>
    </button>
  );
}

const FormatBarSeparator = () => <div className="text-editor-format-bar__sep" />;

export type SpreadsheetFormatBarProps = {
  labels: SpreadsheetUILabels;
  styleState: SelectionStyleState | null;
  visible: boolean;
  onBold: () => void;
  onBorder: () => void;
  onFill: (fill: string | null) => void;
};

export function SpreadsheetFormatBar({
  labels,
  styleState,
  visible,
  onBold,
  onBorder,
  onFill,
}: SpreadsheetFormatBarProps) {
  if (!visible || !styleState) return null;

  const fillPreview =
    styleState.fill === "mixed" || styleState.fill == null ? "#ffffff" : styleState.fill;

  return (
    <div
      className="text-editor-format-bar spreadsheet-format-bar no-print"
      role="toolbar"
      aria-label={labels.formatBarLabel}
    >
      <FormatBarButton title={labels.formatBold} active={styleState.bold === true} onClick={onBold}>
        <Bold />
      </FormatBarButton>
      <FormatBarButton
        title={labels.formatBorder}
        active={styleState.border === true}
        onClick={onBorder}
      >
        <Square />
      </FormatBarButton>
      <FormatBarSeparator />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="spreadsheet-format-bar__fill-trigger text-editor-format-bar__btn"
            title={labels.formatFill}
            aria-label={labels.formatFill}
          >
            <span
              className="spreadsheet-format-bar__fill-swatch"
              style={{ backgroundColor: fillPreview }}
            />
            <PaintBucket className="spreadsheet-format-bar__fill-icon" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="spreadsheet-format-bar__fill-menu">
          <div
            className="spreadsheet-format-bar__swatches"
            role="listbox"
            aria-label={labels.formatFill}
          >
            {FILL_SWATCHES.map((color) => (
              <button
                key={color}
                type="button"
                role="option"
                aria-selected={styleState.fill === color}
                className={cn(
                  "spreadsheet-format-bar__swatch",
                  styleState.fill === color && "spreadsheet-format-bar__swatch--selected",
                )}
                style={{ backgroundColor: color }}
                title={color}
                onClick={() => onFill(color)}
              />
            ))}
          </div>
          <DropdownMenuItem onSelect={() => onFill(null)}>
            {labels.formatFillClear}
          </DropdownMenuItem>
          <label className="spreadsheet-format-bar__custom-fill">
            <span>{labels.formatFillCustom}</span>
            <input
              type="color"
              value={
                fillPreview.startsWith("#") && fillPreview.length === 7 ? fillPreview : "#ffffff"
              }
              onChange={(event) => onFill(event.target.value)}
            />
          </label>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
