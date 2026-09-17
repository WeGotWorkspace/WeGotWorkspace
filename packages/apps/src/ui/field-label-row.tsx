import type { ReactNode } from "react";
import { Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import { Label } from "@/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";

import "./field-label-row.css";

export type FieldLabelRowLabelMode = "caption" | "icon";

export type FieldLabelRowProps = {
  /**
   * Visible caption (caption mode) or accessible name + tooltip text (icon mode).
   * Pass `""` in caption mode to keep the label band with no caption so
   * adjacent FieldLabelRows share a control baseline.
   */
  label?: string;
  /**
   * Same reserved band as `label=""`. Use when the column has no caption
   * (the control must still expose its own name via `aria-label` / `htmlFor` elsewhere).
   * Ignored when `labelMode="icon"`.
   */
  reserveLabel?: boolean;
  children: ReactNode;
  readOnly?: boolean;
  icon?: ReactNode;
  /** Merged onto the outer row (e.g. workspace layout hooks). */
  className?: string;
  /** Merged onto the label (e.g. theme overrides). */
  labelClassName?: string;
  /**
   * Associates the caption with the control's `id` (WCAG: every input needs a label).
   * Omitted when the band is reserved so an empty `<label>` does not become the name.
   */
  htmlFor?: string;
  /**
   * `caption` (default): uppercase text above the control.
   * `icon`: icon only, in front of the control; tooltip shows the label text on hover.
   */
  labelMode?: FieldLabelRowLabelMode;
};

function hasVisibleCaption(label: string | undefined): boolean {
  return Boolean(label?.trim());
}

/** Empty `label` and/or `reserveLabel` keep the caption band in layout. */
function isFieldLabelBandReserved(label: string | undefined, reserveLabel?: boolean): boolean {
  if (hasVisibleCaption(label)) {
    return false;
  }
  return Boolean(reserveLabel) || label !== undefined;
}

function FieldLabelIconLabel({
  label,
  icon,
  readOnly,
  htmlFor,
  className,
}: {
  label: string;
  icon: ReactNode;
  readOnly?: boolean;
  htmlFor?: string;
  className?: string;
}): ReactNode {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Label htmlFor={htmlFor} className={cn("field-label-row__icon-label", className)}>
          {icon}
          <span className="sr-only">{label}</span>
          {readOnly ? <Lock className="field-label-row__lock" aria-hidden /> : null}
        </Label>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Label + control stack shared by simple forms (admin, settings display rows, card demos).
 * Not the RHF `FormField` from `@/ui/form`.
 */
export function FieldLabelRow({
  label,
  reserveLabel,
  children,
  readOnly,
  icon,
  className,
  labelClassName,
  htmlFor,
  labelMode = "caption",
}: FieldLabelRowProps): ReactNode {
  if (labelMode === "icon") {
    const captionText = label?.trim() ?? "";
    return (
      <div className={cn("field-label-row", "field-label-row--icon", className)}>
        {captionText && icon ? (
          <FieldLabelIconLabel
            label={captionText}
            icon={icon}
            readOnly={readOnly}
            htmlFor={htmlFor}
            className={labelClassName}
          />
        ) : null}
        <div className="field-label-row__control">{children}</div>
      </div>
    );
  }

  const caption = hasVisibleCaption(label);
  const reserved = isFieldLabelBandReserved(label, reserveLabel);
  const showLabel = caption || reserved;

  return (
    <div className={cn("field-label-row", className)}>
      {showLabel ? (
        <Label
          htmlFor={caption ? htmlFor : undefined}
          className={cn(
            "field-label-row__label",
            reserved && "field-label-row__label--reserved",
            labelClassName,
          )}
          aria-hidden={reserved || undefined}
        >
          {caption ? (
            <>
              {icon}
              {label}
              {readOnly ? <Lock className="field-label-row__lock" aria-hidden /> : null}
            </>
          ) : (
            "\u00a0"
          )}
        </Label>
      ) : null}
      {children}
    </div>
  );
}
