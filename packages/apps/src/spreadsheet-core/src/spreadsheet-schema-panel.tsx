import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { ChevronDown, Plus, Sigma, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import { Card } from "@/card/src/card";
import { Input } from "@/ui/input";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { cn } from "@/lib/utils";
import {
  defKind,
  extractSheetLocalDefs,
  mergeSheetDefs,
  parseScalarDefInput,
  scalarDefToInput,
  type DefKind,
} from "@/spreadsheet-core/src/spreadsheet-defs-utils";
import type { SpreadsheetUILabels } from "@/spreadsheet-core/src/spreadsheet-labels";
import {
  colLetter,
  isValidRefName,
  type CellType,
  type ColumnSetting,
  type DefMapping,
  type Defs,
  type DefValue,
  type ParsedWorkbook,
} from "@/spreadsheet-core/src/ycsv/ycsv";

const CELL_TYPES: { value: CellType | ""; label: string }[] = [
  { value: "", label: "auto" },
  { value: "string", label: "string" },
  { value: "number", label: "number" },
  { value: "currency", label: "currency" },
  { value: "percent", label: "percent" },
  { value: "date", label: "date" },
  { value: "time", label: "time" },
  { value: "datetime", label: "datetime" },
  { value: "boolean", label: "boolean" },
];

type DefScope = "workbook" | "sheet";

type MergedDefEntry = {
  name: string;
  value: DefValue;
  scope: DefScope;
  kind: DefKind;
};

export type SpreadsheetSchemaPanelProps = {
  workbook: ParsedWorkbook;
  activeSheetIndex: number;
  labels: SpreadsheetUILabels;
  onDefsChange: (workbookDefs: Defs, sheetLocalDefs: Defs) => void;
  onColumnsChange: (columns: ColumnSetting[]) => void;
  className?: string;
};

function nextDefName(defs: Defs, prefix: string): string {
  let n = Object.keys(defs).length + 1;
  let name = `${prefix}_${n}`;
  while (defs[name] != null) {
    n++;
    name = `${prefix}_${n}`;
  }
  return name;
}

function buildMergedDefEntries(workbookDefs: Defs, sheetLocalDefs: Defs): MergedDefEntry[] {
  const merged = mergeSheetDefs(workbookDefs, sheetLocalDefs);
  return Object.entries(merged).map(([name, value]) => ({
    name,
    value,
    kind: defKind(value),
    scope: sheetLocalDefs[name] !== undefined ? "sheet" : "workbook",
  }));
}

export function SpreadsheetSchemaPanel({
  workbook,
  activeSheetIndex,
  labels,
  onDefsChange,
  onColumnsChange,
  className,
}: SpreadsheetSchemaPanelProps) {
  const activeSheet = workbook.sheets[activeSheetIndex];
  const multiSheet = workbook.sheets.length > 1;
  const workbookDefs = workbook.defs;
  const sheetLocalDefs = useMemo(
    () => (activeSheet ? extractSheetLocalDefs(activeSheet.defs, workbookDefs) : {}),
    [activeSheet, workbookDefs],
  );
  const mergedEntries = useMemo(
    () => buildMergedDefEntries(workbookDefs, sheetLocalDefs),
    [sheetLocalDefs, workbookDefs],
  );

  const applyMergedDefs = useCallback(
    (nextMerged: Defs) => {
      if (!activeSheet) return;
      if (multiSheet) {
        onDefsChange(workbookDefs, extractSheetLocalDefs(nextMerged, workbookDefs));
        return;
      }
      onDefsChange(nextMerged, {});
    },
    [activeSheet, multiSheet, onDefsChange, workbookDefs],
  );

  const updateDef = useCallback(
    (oldName: string, patch: { name?: string; value?: DefValue; scope?: DefScope }) => {
      const nextName = patch.name ?? oldName;
      if (!isValidRefName(nextName)) return;

      const nextWorkbook = { ...workbookDefs };
      const nextSheetLocal = { ...sheetLocalDefs };
      const oldScope = sheetLocalDefs[oldName] !== undefined ? "sheet" : "workbook";
      const targetScope = patch.scope ?? oldScope;
      const value =
        patch.value ?? (mergeSheetDefs(workbookDefs, sheetLocalDefs)[oldName] as DefValue);

      if (oldName !== nextName) {
        if (oldScope === "workbook") delete nextWorkbook[oldName];
        else delete nextSheetLocal[oldName];
      }

      if (targetScope === "workbook" || !multiSheet) {
        delete nextSheetLocal[nextName];
        nextWorkbook[nextName] = value;
        onDefsChange(nextWorkbook, nextSheetLocal);
        return;
      }

      if (workbookDefs[nextName] !== undefined) delete nextWorkbook[nextName];
      nextSheetLocal[nextName] = value;
      onDefsChange(nextWorkbook, nextSheetLocal);
    },
    [multiSheet, onDefsChange, sheetLocalDefs, workbookDefs],
  );

  const removeDef = useCallback(
    (name: string) => {
      const nextWorkbook = { ...workbookDefs };
      const nextSheetLocal = { ...sheetLocalDefs };
      if (sheetLocalDefs[name] !== undefined) delete nextSheetLocal[name];
      else delete nextWorkbook[name];
      onDefsChange(nextWorkbook, nextSheetLocal);
    },
    [onDefsChange, sheetLocalDefs, workbookDefs],
  );

  const addScalarDef = useCallback(() => {
    const merged = mergeSheetDefs(workbookDefs, sheetLocalDefs);
    const name = nextDefName(merged, "def");
    applyMergedDefs({ ...merged, [name]: 0 });
  }, [applyMergedDefs, sheetLocalDefs, workbookDefs]);

  const addMappingDef = useCallback(() => {
    const merged = mergeSheetDefs(workbookDefs, sheetLocalDefs);
    const name = nextDefName(merged, "map");
    applyMergedDefs({ ...merged, [name]: { key: "Label" } });
  }, [applyMergedDefs, sheetLocalDefs, workbookDefs]);

  if (!activeSheet) return null;

  return (
    <aside
      className={cn("spreadsheet-workspace__schema-panel", className)}
      aria-label={labels.schemaPanel}
    >
      <DefsSection
        entries={mergedEntries}
        labels={labels}
        multiSheet={multiSheet}
        onAddMapping={addMappingDef}
        onAddScalar={addScalarDef}
        onRemove={removeDef}
        onUpdate={updateDef}
      />
      <ColumnsSection
        columns={activeSheet.columnSettings}
        labels={labels}
        onChange={onColumnsChange}
      />
    </aside>
  );
}

function DefsSection({
  entries,
  labels,
  multiSheet,
  onAddScalar,
  onAddMapping,
  onRemove,
  onUpdate,
}: {
  entries: MergedDefEntry[];
  labels: SpreadsheetUILabels;
  multiSheet: boolean;
  onAddScalar: () => void;
  onAddMapping: () => void;
  onRemove: (name: string) => void;
  onUpdate: (oldName: string, patch: { name?: string; value?: DefValue; scope?: DefScope }) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <Card
      className="spreadsheet-workspace__schema-card"
      title={labels.schemaDefsTitle}
      action={
        <IconButton
          label={open ? labels.schemaSectionCollapse : labels.schemaSectionExpand}
          icon={
            <ChevronDown
              className={cn(
                "spreadsheet-workspace__schema-chevron",
                !open && "spreadsheet-workspace__schema-chevron--closed",
              )}
            />
          }
          size="sm"
          variant="subtle"
          onClick={() => setOpen((value) => !value)}
        />
      }
    >
      {open ? (
        <div className="spreadsheet-workspace__schema-section-body">
          {entries.length === 0 ? (
            <p className="spreadsheet-workspace__schema-empty">{labels.schemaDefsEmpty}</p>
          ) : (
            <ul className="spreadsheet-workspace__schema-def-list">
              {entries.map((entry) => (
                <DefRow
                  key={entry.name}
                  entry={entry}
                  labels={labels}
                  multiSheet={multiSheet}
                  onRemove={() => onRemove(entry.name)}
                  onUpdate={(patch) => onUpdate(entry.name, patch)}
                />
              ))}
            </ul>
          )}
          <div className="spreadsheet-workspace__schema-actions">
            <Button
              label={labels.schemaAddScalarDef}
              icon={<Plus />}
              size="sm"
              variant="subtle"
              onClick={onAddScalar}
            />
            <Button
              label={labels.schemaAddMappingDef}
              icon={<Sigma />}
              size="sm"
              variant="subtle"
              onClick={onAddMapping}
            />
          </div>
          <p className="spreadsheet-workspace__schema-hint">{labels.schemaDefNameHint}</p>
        </div>
      ) : null}
    </Card>
  );
}

function DefRow({
  entry,
  labels,
  multiSheet,
  onUpdate,
  onRemove,
}: {
  entry: MergedDefEntry;
  labels: SpreadsheetUILabels;
  multiSheet: boolean;
  onUpdate: (patch: { name?: string; value?: DefValue; scope?: DefScope }) => void;
  onRemove: () => void;
}) {
  const nameId = useId();
  const [draftName, setDraftName] = useState(entry.name);
  useEffect(() => setDraftName(entry.name), [entry.name]);
  const nameValid = isValidRefName(draftName);

  const commitName = () => {
    if (nameValid && draftName !== entry.name) onUpdate({ name: draftName });
  };

  return (
    <li className="spreadsheet-workspace__schema-def-row">
      <div className="spreadsheet-workspace__schema-def-header">
        <FieldLabelRow
          label={labels.schemaDefName}
          htmlFor={nameId}
          className="spreadsheet-workspace__schema-field"
        >
          <Input
            id={nameId}
            value={draftName}
            spellCheck={false}
            aria-invalid={!nameValid}
            className={cn(!nameValid && "spreadsheet-workspace__schema-input--invalid")}
            onChange={(event) =>
              setDraftName(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))
            }
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === "Enter") (event.target as HTMLInputElement).blur();
            }}
          />
        </FieldLabelRow>
        <div className="spreadsheet-workspace__schema-def-meta">
          <span className="spreadsheet-workspace__schema-tag">{entry.kind}</span>
          {multiSheet ? (
            <span
              className={cn(
                "spreadsheet-workspace__schema-tag",
                entry.scope === "sheet" && "spreadsheet-workspace__schema-tag--sheet",
              )}
            >
              {entry.scope === "sheet" ? labels.schemaDefSheetScope : labels.schemaDefWorkbookScope}
            </span>
          ) : null}
          <IconButton
            label={labels.schemaRemoveDef}
            icon={<Trash2 />}
            size="sm"
            variant="subtle"
            onClick={onRemove}
          />
        </div>
      </div>
      <DefValueEditor
        kind={entry.kind}
        labels={labels}
        value={entry.value}
        onChange={(value) => onUpdate({ value })}
      />
    </li>
  );
}

function DefValueEditor({
  kind,
  value,
  labels,
  onChange,
}: {
  kind: DefKind;
  value: DefValue;
  labels: SpreadsheetUILabels;
  onChange: (value: DefValue) => void;
}) {
  if (kind === "scalar") {
    return (
      <FieldLabelRow label={labels.schemaDefValue} className="spreadsheet-workspace__schema-field">
        <Input
          value={scalarDefToInput(value)}
          spellCheck={false}
          onChange={(event) => onChange(parseScalarDefInput(event.target.value))}
        />
      </FieldLabelRow>
    );
  }

  if (kind === "list") {
    const items = Array.isArray(value) ? value : [];
    return (
      <FieldLabelRow label={labels.schemaDefList} className="spreadsheet-workspace__schema-field">
        <textarea
          className="spreadsheet-workspace__schema-textarea input"
          rows={3}
          value={items.join("\n")}
          spellCheck={false}
          onChange={(event) => {
            const next = event.target.value
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean);
            onChange(next);
          }}
        />
      </FieldLabelRow>
    );
  }

  const mapping = (
    typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}
  ) as DefMapping;

  const updateMappingKey = (oldKey: string, nextKey: string, label: string) => {
    const next: DefMapping = {};
    for (const [key, itemLabel] of Object.entries(mapping)) {
      if (key === oldKey) next[nextKey] = label;
      else next[key] = itemLabel;
    }
    onChange(next);
  };

  const updateMappingLabel = (key: string, label: string) => {
    onChange({ ...mapping, [key]: label });
  };

  const removeMappingKey = (key: string) => {
    const next = { ...mapping };
    delete next[key];
    onChange(next);
  };

  const addMappingKey = () => {
    let n = Object.keys(mapping).length + 1;
    let key = `key_${n}`;
    while (mapping[key] != null) {
      n++;
      key = `key_${n}`;
    }
    onChange({ ...mapping, [key]: "Label" });
  };

  return (
    <div className="spreadsheet-workspace__schema-mapping">
      <p className="spreadsheet-workspace__schema-mapping-title">{labels.schemaDefMapping}</p>
      <ul className="spreadsheet-workspace__schema-mapping-list">
        {Object.entries(mapping).map(([key, label]) => (
          <li key={key} className="spreadsheet-workspace__schema-mapping-row">
            <Input
              value={key}
              spellCheck={false}
              aria-label={labels.schemaMappingKey}
              onChange={(event) => updateMappingKey(key, event.target.value, label)}
            />
            <Input
              value={label}
              spellCheck={false}
              aria-label={labels.schemaMappingLabel}
              onChange={(event) => updateMappingLabel(key, event.target.value)}
            />
            <IconButton
              label={labels.schemaRemoveMappingKey}
              icon={<Trash2 />}
              size="sm"
              variant="subtle"
              onClick={() => removeMappingKey(key)}
            />
          </li>
        ))}
      </ul>
      <Button
        label={labels.schemaAddMappingKey}
        icon={<Plus />}
        size="sm"
        variant="subtle"
        onClick={addMappingKey}
      />
    </div>
  );
}

function ColumnsSection({
  columns,
  labels,
  onChange,
}: {
  columns: ColumnSetting[];
  labels: SpreadsheetUILabels;
  onChange: (columns: ColumnSetting[]) => void;
}) {
  const [open, setOpen] = useState(true);

  const updateColumn = (index: number, patch: Partial<ColumnSetting>) => {
    const next = columns.map((column, columnIndex) => {
      if (columnIndex !== index) return column;
      const merged = { ...column, ...patch };
      if (patch.ref !== undefined) {
        merged.refExplicit = patch.ref !== colLetter(index);
      }
      return merged;
    });
    onChange(next);
  };

  const addColumn = () => {
    const index = columns.length;
    const ref = colLetter(index);
    onChange([...columns, { ref, name: ref, refExplicit: false }]);
  };

  return (
    <Card
      className="spreadsheet-workspace__schema-card"
      title={labels.schemaColumnsTitle}
      action={
        <IconButton
          label={open ? labels.schemaSectionCollapse : labels.schemaSectionExpand}
          icon={
            <ChevronDown
              className={cn(
                "spreadsheet-workspace__schema-chevron",
                !open && "spreadsheet-workspace__schema-chevron--closed",
              )}
            />
          }
          size="sm"
          variant="subtle"
          onClick={() => setOpen((value) => !value)}
        />
      }
    >
      {open ? (
        <div className="spreadsheet-workspace__schema-section-body">
          <ul className="spreadsheet-workspace__schema-column-list">
            {columns.map((column, index) => (
              <ColumnRow
                key={`${index}-${column.ref ?? colLetter(index)}`}
                column={column}
                index={index}
                labels={labels}
                onPatch={(patch) => updateColumn(index, patch)}
              />
            ))}
          </ul>
          <div className="spreadsheet-workspace__schema-actions">
            <Button
              label={labels.schemaAddColumn}
              icon={<Plus />}
              size="sm"
              variant="subtle"
              onClick={addColumn}
            />
          </div>
          <p className="spreadsheet-workspace__schema-hint">{labels.schemaColumnRefHint}</p>
        </div>
      ) : null}
    </Card>
  );
}

function ColumnRow({
  column,
  index,
  labels,
  onPatch,
}: {
  column: ColumnSetting;
  index: number;
  labels: SpreadsheetUILabels;
  onPatch: (patch: Partial<ColumnSetting>) => void;
}) {
  const fallback = colLetter(index);
  const refId = useId();
  const nameId = useId();
  const typeId = useId();
  const [draftRef, setDraftRef] = useState(column.ref ?? fallback);
  const [draftName, setDraftName] = useState(column.name ?? column.ref ?? fallback);
  useEffect(() => setDraftRef(column.ref ?? fallback), [column.ref, fallback]);
  useEffect(
    () => setDraftName(column.name ?? column.ref ?? fallback),
    [column.name, column.ref, fallback],
  );

  const refValid = isValidRefName(draftRef) || draftRef === fallback;
  const showCurrency = column.type === "currency";

  const commitRef = () => {
    if (!refValid) return;
    if (draftRef !== (column.ref ?? fallback)) {
      onPatch({ ref: draftRef, refExplicit: draftRef !== fallback });
    }
  };

  const commitName = () => {
    if (draftName !== (column.name ?? "")) onPatch({ name: draftName });
  };

  return (
    <li className="spreadsheet-workspace__schema-column-row">
      <div className="spreadsheet-workspace__schema-column-position">
        <span className="spreadsheet-workspace__schema-column-index">{fallback}</span>
        <span
          className={cn(
            "spreadsheet-workspace__schema-tag",
            column.refExplicit
              ? "spreadsheet-workspace__schema-tag--explicit"
              : "spreadsheet-workspace__schema-tag--implicit",
          )}
        >
          {column.refExplicit ? labels.schemaColumnExplicit : labels.schemaColumnImplicit}
        </span>
      </div>
      <FieldLabelRow
        label={labels.schemaColumnRef}
        htmlFor={refId}
        className="spreadsheet-workspace__schema-field"
      >
        <Input
          id={refId}
          value={draftRef}
          placeholder={fallback}
          spellCheck={false}
          aria-invalid={!refValid}
          className={cn(!refValid && "spreadsheet-workspace__schema-input--invalid")}
          onChange={(event) =>
            setDraftRef(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))
          }
          onBlur={commitRef}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          }}
        />
      </FieldLabelRow>
      <FieldLabelRow
        label={labels.schemaColumnName}
        htmlFor={nameId}
        className="spreadsheet-workspace__schema-field"
      >
        <Input
          id={nameId}
          value={draftName}
          placeholder={column.ref ?? fallback}
          spellCheck={false}
          onChange={(event) => setDraftName(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          }}
        />
      </FieldLabelRow>
      <FieldLabelRow
        label={labels.schemaColumnType}
        htmlFor={typeId}
        className="spreadsheet-workspace__schema-field"
      >
        <Select
          value={column.type ?? "auto"}
          onValueChange={(value) =>
            onPatch({ type: value === "auto" ? undefined : (value as CellType) })
          }
        >
          <SelectTrigger id={typeId} className="spreadsheet-workspace__schema-select">
            <SelectValue placeholder="auto" />
          </SelectTrigger>
          <SelectContent>
            {CELL_TYPES.map((option) => (
              <SelectItem key={option.value || "auto"} value={option.value || "auto"}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldLabelRow>
      {showCurrency ? (
        <>
          <FieldLabelRow
            label={labels.schemaColumnCurrency}
            className="spreadsheet-workspace__schema-field"
          >
            <Input
              value={typeof column.currency === "string" ? column.currency : ""}
              placeholder="EUR"
              spellCheck={false}
              onChange={(event) => onPatch({ currency: event.target.value || undefined })}
            />
          </FieldLabelRow>
          <FieldLabelRow
            label={labels.schemaColumnLocale}
            className="spreadsheet-workspace__schema-field"
          >
            <Input
              value={typeof column.locale === "string" ? column.locale : ""}
              placeholder="nl-NL"
              spellCheck={false}
              onChange={(event) => onPatch({ locale: event.target.value || undefined })}
            />
          </FieldLabelRow>
        </>
      ) : null}
    </li>
  );
}
