import { createContext, useContext, type ReactNode } from "react";
import { Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import { Label } from "@/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";

import "./field-label-row.css";

export type FieldLabelRowLabelMode = "caption" | "icon";

export type FieldLabelRowLayout = "stacked" | "inline";

const FieldLabelModeContext = createContext<FieldLabelRowLabelMode>("caption");

/** The label mode rows here get: `icon` inside `FieldLabelRowIconLabels`. */
export function useFieldLabelMode(): FieldLabelRowLabelMode {
  return useContext(FieldLabelModeContext);
}

/**
 * Rows inside show their icon in place of the caption, the control across the row: one
 * column for a compact editor (the event popover). A row without an icon keeps its layout.
 */
export function FieldLabelRowIconLabels({ children }: { children: ReactNode }): ReactNode {
  return <FieldLabelModeContext.Provider value="icon">{children}</FieldLabelModeContext.Provider>;
}

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
  /**
   * The field's icon when rows are icon-labelled (`FieldLabelRowIconLabels`); a caption row
   * never shows it. Falls back to `icon`.
   */
  labelIcon?: ReactNode;
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
   * `caption`: label text above the control (source string owns casing).
   * `icon`: icon only, in front of the control; tooltip shows the label text on hover.
   * Defaults to the surrounding `FieldLabelRowIconLabels`, else `caption`.
   */
  labelMode?: FieldLabelRowLabelMode;
  /**
   * `stacked` (default): caption above the control.
   * `inline`: two columns, caption and description start, control end, rows split by the
   * suite hairline (suite norm for dialogs and settings).
   */
  layout?: FieldLabelRowLayout;
  /** Quiet line under the caption (`inline` layout). */
  description?: ReactNode;
  /**
   * `inline` layout: the control takes the whole end column (a text field). Off, it
   * hugs its content (a dropdown, a switch).
   */
  fill?: boolean;
  /**
   * `inline` layout: content under the row, across its full width (an add field and a
   * list of people, alarms).
   */
  below?: ReactNode;
  /** `inline` layout: the row opens a section; its caption is a step bigger, full ink. */
  section?: boolean;
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

function FieldLabelRowIcon({
  label,
  description,
  fill,
  below,
  children,
  readOnly,
  icon,
  className,
  labelClassName,
  htmlFor,
}: FieldLabelRowProps): ReactNode {
  const captionText = label?.trim() ?? "";
  return (
    <div
      className={cn(
        "field-label-row",
        "field-label-row--icon",
        fill && "field-label-row--fill",
        className,
      )}
    >
      {captionText && icon ? (
        <FieldLabelIconLabel
          label={captionText}
          icon={icon}
          readOnly={readOnly}
          htmlFor={htmlFor}
          className={labelClassName}
        />
      ) : null}
      <div className="field-label-row__control">
        {children}
        {description ? <p className="field-label-row__description">{description}</p> : null}
        {below != null ? <div className="field-label-row__below">{below}</div> : null}
      </div>
    </div>
  );
}

function FieldLabelRowInline({
  label,
  description,
  fill,
  below,
  section,
  children,
  readOnly,
  icon,
  className,
  labelClassName,
  htmlFor,
}: FieldLabelRowProps): ReactNode {
  return (
    <div
      className={cn(
        "field-label-row",
        "field-label-row--inline",
        fill && "field-label-row--fill",
        section && "field-label-row--section",
        className,
      )}
    >
      <div className="field-label-row__text">
        <Label htmlFor={htmlFor} className={cn("field-label-row__label", labelClassName)}>
          {icon}
          {label}
          {readOnly ? <Lock className="field-label-row__lock" aria-hidden /> : null}
        </Label>
        {description ? <p className="field-label-row__description">{description}</p> : null}
      </div>
      <div className="field-label-row__control">{children}</div>
      {below != null ? <div className="field-label-row__below">{below}</div> : null}
    </div>
  );
}

/**
 * Label + control shared by forms (dialogs, settings, admin): stacked, inline (two columns)
 * or icon-labelled. Not the RHF `FormField` from `@/ui/form`.
 */
export function FieldLabelRow({
  label,
  reserveLabel,
  children,
  readOnly,
  icon,
  labelIcon,
  className,
  labelClassName,
  htmlFor,
  labelMode,
  layout = "stacked",
  description,
  fill,
  below,
  section,
}: FieldLabelRowProps): ReactNode {
  const contextLabelMode = useFieldLabelMode();
  const fieldIcon = labelIcon ?? icon;
  if ((labelMode ?? contextLabelMode) === "icon" && fieldIcon) {
    return (
      <FieldLabelRowIcon
        label={label}
        description={description}
        fill={fill}
        below={below}
        readOnly={readOnly}
        icon={fieldIcon}
        className={className}
        labelClassName={labelClassName}
        htmlFor={htmlFor}
      >
        {children}
      </FieldLabelRowIcon>
    );
  }

  if (layout === "inline") {
    return (
      <FieldLabelRowInline
        label={label}
        description={description}
        fill={fill}
        below={below}
        section={section}
        readOnly={readOnly}
        icon={icon}
        className={className}
        labelClassName={labelClassName}
        htmlFor={htmlFor}
      >
        {children}
      </FieldLabelRowInline>
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
