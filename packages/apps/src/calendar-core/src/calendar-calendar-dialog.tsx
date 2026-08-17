import { useEffect, useId, useRef, useState } from "react";
import { Button, buttonVariants } from "@/button/src/button";
import { Input } from "@/ui/input";
import { FieldLabelRow } from "@/ui/field-label-row";
import {
  groupSlugFromOwnerScopeValue,
  OwnerScopeField,
  ownerScopeValueFromDirectory,
  PERSONAL_SCOPE_VALUE,
} from "@/ui/owner-scope-field";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { cn } from "@/lib/utils";
import type { CalendarDirectoryGroup } from "@/calendar-core/src/calendar-types";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import { CalendarColorSwatchTrigger } from "@/calendar-core/src/calendar-color-swatch-trigger";
import "./calendar-calendar-dialog.css";

export const CALENDAR_COLOR_SWATCHES = [
  "#6366f1",
  "#0ea5e9",
  "#22c55e",
  "#f59e0b",
  "#ec4899",
  "#ef4444",
  "#8b5cf6",
  "#14b8a6",
] as const;

export const DEFAULT_CALENDAR_COLOR = CALENDAR_COLOR_SWATCHES[0];

export type CalendarCalendarDialogState =
  | null
  | { mode: "create" }
  | {
      mode: "edit";
      calendarId: string;
      name: string;
      color: string;
      mayDelete: boolean;
      scope?: "personal" | "group";
      groupSlug?: string | null;
    };

export type CalendarCalendarDialogConfirmInput = {
  name: string;
  color: string;
  groupSlug?: string | null;
};

type CalendarCalendarDialogProps = {
  dialog: CalendarCalendarDialogState;
  labels: CalendarUILabels;
  groups?: CalendarDirectoryGroup[];
  personalOwnerLabel?: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (input: CalendarCalendarDialogConfirmInput) => void;
  onDelete?: () => void;
};

function ColorPicker({
  value,
  onChange,
  colorLabel,
}: {
  value: string;
  onChange: (color: string) => void;
  colorLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const customColorInputRef = useRef<HTMLInputElement>(null);
  const customColorInputId = useId();
  const colorLabelId = useId();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <CalendarColorSwatchTrigger color={value} label={colorLabel} aria-haspopup="dialog" />
      </PopoverTrigger>
      <PopoverContent align="end" className="calendar-calendar-dialog__color-content">
        <div
          className="calendar-calendar-dialog__swatches"
          role="radiogroup"
          aria-labelledby={colorLabelId}
        >
          <span id={colorLabelId} className="sr-only">
            {colorLabel}
          </span>
          {CALENDAR_COLOR_SWATCHES.map((swatch) => {
            const selected = value.toLowerCase() === swatch.toLowerCase();
            return (
              <button
                key={swatch}
                type="button"
                className={cn(
                  "calendar-calendar-dialog__swatch",
                  selected && "calendar-calendar-dialog__swatch--selected",
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
            className="calendar-calendar-dialog__swatch calendar-calendar-dialog__swatch--custom"
            aria-label="Custom color"
            onClick={() => customColorInputRef.current?.click()}
          >
            <span className="calendar-calendar-dialog__custom-marker" aria-hidden />
          </button>
          <input
            ref={customColorInputRef}
            id={customColorInputId}
            type="color"
            className="calendar-calendar-dialog__native-color"
            value={value}
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              onChange(event.target.value);
              setOpen(false);
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function CalendarCalendarDialog({
  dialog,
  labels,
  groups = [],
  personalOwnerLabel = "Me",
  busy = false,
  onClose,
  onConfirm,
  onDelete,
}: CalendarCalendarDialogProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_CALENDAR_COLOR);
  const [scopeValue, setScopeValue] = useState(PERSONAL_SCOPE_VALUE);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const open = dialog !== null;
  const isCreate = dialog?.mode === "create";

  useEffect(() => {
    if (!dialog) {
      setConfirmDeleteOpen(false);
      return;
    }
    if (dialog.mode === "create") {
      setName("");
      setColor(DEFAULT_CALENDAR_COLOR);
      setScopeValue(PERSONAL_SCOPE_VALUE);
      return;
    }
    setName(dialog.name);
    setColor(dialog.color || DEFAULT_CALENDAR_COLOR);
    setScopeValue(ownerScopeValueFromDirectory(dialog.scope, dialog.groupSlug));
  }, [dialog]);

  const trimmedName = name.trim();
  const selectedColor = color.trim() || DEFAULT_CALENDAR_COLOR;
  const unchangedEdit =
    dialog?.mode === "edit" &&
    trimmedName === dialog.name.trim() &&
    selectedColor.toLowerCase() === dialog.color.trim().toLowerCase();
  const canSubmit = Boolean(trimmedName) && (isCreate || !unchangedEdit) && !busy;
  const canDelete = dialog?.mode === "edit" && dialog.mayDelete && Boolean(onDelete);
  const ownerLabels = {
    label: labels.calendarDirectoryLabel,
    personal: labels.calendarDirectoryPersonal,
    group: labels.calendarDirectoryGroup,
    readOnlyLabel: labels.calendarDirectoryReadOnlyLabel,
  };

  /** Portaled popover / native color picker sit outside DialogContent in the DOM. */
  const keepOpenForPortaledLayer = (event: Event) => {
    const target = event.target as Element | null;
    const active = document.activeElement;
    if (
      target?.closest("[data-radix-popper-content-wrapper]") ||
      (target instanceof HTMLInputElement && target.type === "color") ||
      target?.closest(".calendar-calendar-dialog__native-color") ||
      (active instanceof HTMLInputElement && active.type === "color")
    ) {
      event.preventDefault();
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
        <DialogContent
          className="calendar-dialog-surface"
          onPointerDownOutside={keepOpenForPortaledLayer}
          onInteractOutside={keepOpenForPortaledLayer}
          onFocusOutside={keepOpenForPortaledLayer}
        >
          <DialogHeader>
            <DialogTitle>
              {isCreate ? labels.createCalendarTitle : labels.editCalendarTitle}
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!canSubmit) return;
              onConfirm({
                name: trimmedName,
                color: selectedColor,
                ...(isCreate ? { groupSlug: groupSlugFromOwnerScopeValue(scopeValue) } : {}),
              });
            }}
          >
            <FieldLabelRow label={labels.calendarNameLabel} htmlFor="calendar-calendar-name">
              <div className="calendar-calendar-dialog__name-color-row">
                <Input
                  id="calendar-calendar-name"
                  className="calendar-calendar-dialog__name-input"
                  autoFocus
                  value={name}
                  disabled={busy}
                  onChange={(event) => setName(event.target.value)}
                />
                <ColorPicker
                  value={selectedColor}
                  onChange={setColor}
                  colorLabel={labels.calendarColorLabel}
                />
              </div>
            </FieldLabelRow>

            <OwnerScopeField
              id="calendar-calendar-directory"
              value={scopeValue}
              onValueChange={setScopeValue}
              groups={groups}
              personalOwnerLabel={personalOwnerLabel}
              labels={ownerLabels}
              disabled={!isCreate || busy}
            />

            <DialogFooter className="calendar-calendar-dialog__footer">
              {canDelete ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="calendar-calendar-dialog__delete"
                  disabled={busy}
                  onClick={() => setConfirmDeleteOpen(true)}
                >
                  {labels.deleteCalendar}
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                {labels.cancel}
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {labels.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmDeleteOpen}
        onOpenChange={(next) => !busy && setConfirmDeleteOpen(next)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.deleteCalendarConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {labels.deleteCalendarConfirmDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{labels.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                onDelete?.();
                setConfirmDeleteOpen(false);
              }}
            >
              {labels.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
