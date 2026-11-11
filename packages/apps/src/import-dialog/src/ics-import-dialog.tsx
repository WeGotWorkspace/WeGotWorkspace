import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/button/src/button";
import { ImportDialog, type ImportDialogResult } from "@/import-dialog/src/import-dialog";
import { Input } from "@/ui/input";
import { FieldLabelRow } from "@/ui/field-label-row";
import { DialogFooter } from "@/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { SwatchColorPicker } from "@/ui/swatch-color-picker";
import { ColorSwatchTrigger } from "@/ui/color-swatch-trigger";
import { NAME_COLOR_ROW_INPUT_CLASS, NameColorRow } from "@/ui/name-color-row";
import { CalendarPickerMenuItem } from "@/lib/calendar-event-calendar-picker";
import {
  inferCollectionNameFromIcsFileName,
  type IcsImportDestination,
} from "@/lib/ics-import/ics-file";
import "./ics-import-dialog.css";

/** Destination value for "create a new collection" in the destination menu. */
export const NEW_COLLECTION_IMPORT_VALUE = "__new_collection__";

/** A writable collection (calendar or task list) the file can go into. */
export type IcsImportCollection = {
  id: string;
  name: string;
  color: string;
  /** Replaces the colour dot in the menu, e.g. a task-list glyph. */
  icon?: ReactNode;
};

export type IcsImportDialogLabels = {
  title: string;
  destinationLegend: string;
  newCollection: string;
  nameLabel: string;
  colorLabel: string;
  cancel: string;
  submit: string;
};

/** After an import: what to show instead of the form, and how to close it. */
export type IcsImportDialogResult = ImportDialogResult & { doneLabel: string };

export type IcsImportDialogProps = {
  open: boolean;
  file: File;
  labels: IcsImportDialogLabels;
  /** Writable destinations only, in menu order. */
  collections: IcsImportCollection[];
  /** Preselected destination; ignored when it is not in `collections`. */
  defaultCollectionId?: string;
  swatches: readonly string[];
  defaultColor: string;
  /** Prefix for field ids, so two import dialogs never share one. */
  idPrefix: string;
  contentClassName?: string;
  busy?: boolean;
  error?: string | null;
  /** Set while the import cannot run (offline): Import is disabled and this says why. */
  unavailableReason?: string | null;
  result?: IcsImportDialogResult | null;
  onClose: () => void;
  onImport: (file: File, destination: IcsImportDestination) => void;
};

function initialDestinationId(collections: IcsImportCollection[], preferredId?: string): string {
  if (preferredId && collections.some((collection) => collection.id === preferredId)) {
    return preferredId;
  }
  return collections[0]?.id ?? NEW_COLLECTION_IMPORT_VALUE;
}

/**
 * ICS import dialog shared by Calendar and Tasks: pick an existing writable
 * collection or create one (name from the file name, colour), then import.
 */
export function IcsImportDialog({
  open,
  file,
  labels,
  collections,
  defaultCollectionId,
  swatches,
  defaultColor,
  idPrefix,
  contentClassName,
  busy = false,
  error = null,
  unavailableReason = null,
  result = null,
  onClose,
  onImport,
}: IcsImportDialogProps) {
  const defaultName = inferCollectionNameFromIcsFileName(file.name) || labels.newCollection;
  const preselectedId = initialDestinationId(collections, defaultCollectionId);
  const [destinationId, setDestinationId] = useState(preselectedId);
  const [name, setName] = useState(defaultName);
  const [color, setColor] = useState<string>(defaultColor);

  useEffect(() => {
    if (!open) return;
    setDestinationId(preselectedId);
    setName(defaultName);
    setColor(defaultColor);
  }, [open, file, preselectedId, defaultName, defaultColor]);

  const creating = destinationId === NEW_COLLECTION_IMPORT_VALUE;
  const selected = collections.find((collection) => collection.id === destinationId);
  const destinationName = creating
    ? labels.newCollection
    : (selected?.name ?? labels.destinationLegend);
  const destinationReady = creating ? name.trim() !== "" : destinationId.trim() !== "";
  const canSubmit = destinationReady && !busy && !unavailableReason;
  const destinationFieldId = `${idPrefix}-import-destination`;
  const nameFieldId = `${idPrefix}-import-name`;

  return (
    <ImportDialog
      open={open}
      title={labels.title}
      error={error ?? unavailableReason}
      result={result}
      busy={busy}
      onClose={onClose}
      className={contentClassName}
    >
      {result ? (
        <DialogFooter>
          <Button type="button" label={result.doneLabel} onClick={onClose} />
        </DialogFooter>
      ) : (
        <form
          className="ics-import-dialog"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            onImport(
              file,
              creating
                ? { mode: "create", name: name.trim(), color: color.trim() || defaultColor }
                : { mode: "existing", collectionId: destinationId },
            );
          }}
        >
          <FieldLabelRow label={labels.destinationLegend} htmlFor={destinationFieldId}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <ColorSwatchTrigger
                  id={destinationFieldId}
                  color={selected?.color}
                  showSwatch={!creating}
                  size="sm"
                  label={`${labels.destinationLegend}: ${destinationName}`}
                  className="ics-import-dialog__destination"
                  disabled={busy}
                >
                  {destinationName}
                </ColorSwatchTrigger>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="calendar-event-dialog__calendar-menu ics-import-dialog__destination-menu"
              >
                {collections.map((collection) => (
                  <CalendarPickerMenuItem
                    key={collection.id}
                    name={collection.name}
                    color={collection.color}
                    icon={collection.icon}
                    selected={destinationId === collection.id}
                    onSelect={() => setDestinationId(collection.id)}
                  />
                ))}
                {collections.length > 0 ? <DropdownMenuSeparator /> : null}
                <CalendarPickerMenuItem
                  name={labels.newCollection}
                  selected={creating}
                  onSelect={() => setDestinationId(NEW_COLLECTION_IMPORT_VALUE)}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </FieldLabelRow>
          {creating ? (
            <div className="ics-import-dialog__create-fields">
              <FieldLabelRow label={labels.nameLabel} htmlFor={nameFieldId}>
                <NameColorRow>
                  <Input
                    id={nameFieldId}
                    className={NAME_COLOR_ROW_INPUT_CLASS}
                    size="sm"
                    value={name}
                    disabled={busy}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <SwatchColorPicker
                    value={color}
                    onChange={setColor}
                    colorLabel={labels.colorLabel}
                    swatches={swatches}
                  >
                    <ColorSwatchTrigger
                      color={color}
                      label={labels.colorLabel}
                      size="sm"
                      aria-haspopup="dialog"
                    />
                  </SwatchColorPicker>
                </NameColorRow>
              </FieldLabelRow>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              label={labels.cancel}
              disabled={busy}
              onClick={onClose}
            />
            <Button type="submit" label={labels.submit} disabled={!canSubmit} />
          </DialogFooter>
        </form>
      )}
    </ImportDialog>
  );
}
