import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Plus, Sigma, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import { Card } from "@/card/src/card";
import { Input } from "@/ui/input";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { SegmentedControl } from "@/segmented-control/src/segmented-control";
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

type SchemaTab = "defs" | "columns";
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

function defCaption(
  entry: MergedDefEntry,
  labels: SpreadsheetUILabels,
  multiSheet: boolean,
): string {
  const kind =
    entry.kind === "scalar"
      ? labels.schemaDefKindScalar
      : entry.kind === "list"
        ? labels.schemaDefKindList
        : labels.schemaDefKindMapping;
  if (!multiSheet) return kind;
  const scope =
    entry.scope === "sheet" ? labels.schemaDefSheetScope : labels.schemaDefWorkbookScope;
  return `${kind} · ${scope}`;
}

export function SpreadsheetSchemaPanel({
  workbook,
  activeSheetIndex,
  labels,
  onDefsChange,
  onColumnsChange,
  className,
}: SpreadsheetSchemaPanelProps) {
  const [activeTab, setActiveTab] = useState<SchemaTab>("defs");
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
      <div className="spreadsheet-workspace__schema-toolbar">
        <SegmentedControl
          value={activeTab}
          onChange={setActiveTab}
          size="md"
          className="spreadsheet-workspace__schema-segmented"
          aria-label={labels.schemaPanelSections}
          options={[
            { value: "defs", label: labels.schemaDefsTitle },
            { value: "columns", label: labels.schemaColumnsTitle },
          ]}
        />
      </div>

      <div className="spreadsheet-workspace__schema-scroll">
        {activeTab === "defs" ? (
          <DefsSection
            entries={mergedEntries}
            labels={labels}
            multiSheet={multiSheet}
            onAddMapping={addMappingDef}
            onAddScalar={addScalarDef}
            onRemove={removeDef}
            onUpdate={updateDef}
          />
        ) : (
          <ColumnsSection
            columns={activeSheet.columnSettings}
            labels={labels}
            onChange={onColumnsChange}
          />
        )}
      </div>
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
  return (
    <div className="spreadsheet-workspace__schema-section">
      {entries.length === 0 ? (
        <div className="spreadsheet-workspace__schema-empty-state">
          <p className="spreadsheet-workspace__schema-empty-title">{labels.schemaDefsEmptyTitle}</p>
          <p className="spreadsheet-workspace__schema-empty">{labels.schemaDefsEmpty}</p>
        </div>
      ) : (
        <ul className="spreadsheet-workspace__schema-def-list">
          {entries.map((entry) => (
            <DefRow
              key={entry.name}
              caption={defCaption(entry, labels, multiSheet)}
              entry={entry}
              labels={labels}
              onRemove={() => onRemove(entry.name)}
              onUpdate={(patch) => onUpdate(entry.name, patch)}
            />
          ))}
        </ul>
      )}

      <footer className="spreadsheet-workspace__schema-footer">
        <div className="spreadsheet-workspace__schema-footer-actions">
          <Button
            label={labels.schemaAddScalarDef}
            icon={<Plus />}
            size="sm"
            variant="outline"
            onClick={onAddScalar}
          />
          <Button
            label={labels.schemaAddMappingDef}
            icon={<Sigma />}
            size="sm"
            variant="outline"
            onClick={onAddMapping}
          />
        </div>
        <p className="spreadsheet-workspace__schema-hint">{labels.schemaDefNameHint}</p>
      </footer>
    </div>
  );
}

function DefRow({
  entry,
  caption,
  labels,
  onUpdate,
  onRemove,
}: {
  entry: MergedDefEntry;
  caption: string;
  labels: SpreadsheetUILabels;
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
    <li>
      <Card
        className="spreadsheet-workspace__schema-def-card"
        action={
          <IconButton
            label={labels.schemaRemoveDef}
            icon={<Trash2 />}
            size="sm"
            variant="ghost"
            onClick={onRemove}
          />
        }
      >
        <p className="spreadsheet-workspace__schema-caption">{caption}</p>
        <FieldLabelRow label={labels.schemaDefName} htmlFor={nameId}>
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
        <DefValueEditor
          kind={entry.kind}
          labels={labels}
          value={entry.value}
          onChange={(value) => onUpdate({ value })}
        />
      </Card>
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
      <FieldLabelRow label={labels.schemaDefValue}>
        <ScalarDefInput value={value} onChange={onChange} />
      </FieldLabelRow>
    );
  }

  if (kind === "list") {
    return (
      <FieldLabelRow label={labels.schemaDefList}>
        <ListDefInput value={value} onChange={onChange} />
      </FieldLabelRow>
    );
  }

  const mapping = (
    typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}
  ) as DefMapping;

  return <MappingDefEditor mapping={mapping} labels={labels} onChange={onChange} />;
}

function ScalarDefInput({
  value,
  onChange,
}: {
  value: DefValue;
  onChange: (value: DefValue) => void;
}) {
  const [draft, setDraft] = useState(() => scalarDefToInput(value));
  useEffect(() => setDraft(scalarDefToInput(value)), [value]);

  const commit = () => {
    const parsed = parseScalarDefInput(draft);
    if (scalarDefToInput(parsed) !== scalarDefToInput(value)) onChange(parsed);
  };

  return (
    <Input
      value={draft}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
      }}
    />
  );
}

function ListDefInput({
  value,
  onChange,
}: {
  value: DefValue;
  onChange: (value: DefValue) => void;
}) {
  const items = Array.isArray(value) ? value : [];
  const itemsText = items.join("\n");
  const [draft, setDraft] = useState(itemsText);
  useEffect(() => setDraft(itemsText), [itemsText]);

  const commit = () => {
    const next = draft
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (next.join("\n") !== items.join("\n")) onChange(next);
  };

  return (
    <textarea
      className="spreadsheet-workspace__schema-textarea input"
      rows={3}
      value={draft}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
    />
  );
}

function MappingDefEditor({
  mapping,
  labels,
  onChange,
}: {
  mapping: DefMapping;
  labels: SpreadsheetUILabels;
  onChange: (value: DefMapping) => void;
}) {
  const entries = Object.entries(mapping);

  const replaceMappingKey = (oldKey: string, nextKey: string, label: string) => {
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
      <p className="spreadsheet-workspace__schema-mapping-label">{labels.schemaDefMapping}</p>
      {entries.length === 0 ? (
        <p className="spreadsheet-workspace__schema-empty">{labels.schemaMappingEmpty}</p>
      ) : (
        <div className="spreadsheet-workspace__schema-mapping-table" role="table">
          <div className="spreadsheet-workspace__schema-mapping-head" role="row">
            <span role="columnheader">{labels.schemaMappingKey}</span>
            <span role="columnheader">{labels.schemaMappingLabel}</span>
            <span className="spreadsheet-workspace__schema-mapping-head-action" aria-hidden />
          </div>
          <ul className="spreadsheet-workspace__schema-mapping-list" role="rowgroup">
            {entries.map(([key, label], index) => (
              <MappingKeyRow
                key={`mapping-row-${index}`}
                initialKey={key}
                initialLabel={label}
                labels={labels}
                onCommitKey={(oldKey, nextKey) => replaceMappingKey(oldKey, nextKey, label)}
                onCommitLabel={(rowKey, nextLabel) => updateMappingLabel(rowKey, nextLabel)}
                onRemove={() => removeMappingKey(key)}
              />
            ))}
          </ul>
        </div>
      )}
      <Button
        label={labels.schemaAddMappingKey}
        icon={<Plus />}
        size="sm"
        variant="ghost"
        onClick={addMappingKey}
      />
    </div>
  );
}

function MappingKeyRow({
  initialKey,
  initialLabel,
  labels,
  onCommitKey,
  onCommitLabel,
  onRemove,
}: {
  initialKey: string;
  initialLabel: string;
  labels: SpreadsheetUILabels;
  onCommitKey: (oldKey: string, nextKey: string) => void;
  onCommitLabel: (key: string, label: string) => void;
  onRemove: () => void;
}) {
  const keyId = useId();
  const labelId = useId();
  const [draftKey, setDraftKey] = useState(initialKey);
  const [draftLabel, setDraftLabel] = useState(initialLabel);
  useEffect(() => setDraftKey(initialKey), [initialKey]);
  useEffect(() => setDraftLabel(initialLabel), [initialLabel]);

  const commitKey = () => {
    if (draftKey !== initialKey) onCommitKey(initialKey, draftKey);
  };

  const commitLabel = () => {
    if (draftLabel !== initialLabel) onCommitLabel(initialKey, draftLabel);
  };

  return (
    <li className="spreadsheet-workspace__schema-mapping-row" role="row">
      <div role="cell">
        <Input
          id={keyId}
          value={draftKey}
          spellCheck={false}
          aria-label={labels.schemaMappingKey}
          onChange={(event) => setDraftKey(event.target.value)}
          onBlur={commitKey}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          }}
        />
      </div>
      <div role="cell">
        <Input
          id={labelId}
          value={draftLabel}
          spellCheck={false}
          aria-label={labels.schemaMappingLabel}
          onChange={(event) => setDraftLabel(event.target.value)}
          onBlur={commitLabel}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          }}
        />
      </div>
      <div className="spreadsheet-workspace__schema-mapping-row-action" role="cell">
        <IconButton
          label={labels.schemaRemoveMappingKey}
          icon={<Trash2 />}
          size="sm"
          variant="ghost"
          onClick={onRemove}
        />
      </div>
    </li>
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
    <div className="spreadsheet-workspace__schema-section">
      {columns.length === 0 ? (
        <div className="spreadsheet-workspace__schema-empty-state">
          <p className="spreadsheet-workspace__schema-empty-title">
            {labels.schemaColumnsEmptyTitle}
          </p>
          <p className="spreadsheet-workspace__schema-empty">{labels.schemaColumnsEmpty}</p>
        </div>
      ) : (
        <ul className="spreadsheet-workspace__schema-column-list">
          {columns.map((column, index) => (
            <ColumnRow
              key={`column-row-${index}`}
              column={column}
              index={index}
              labels={labels}
              onPatch={(patch) => updateColumn(index, patch)}
            />
          ))}
        </ul>
      )}

      <footer className="spreadsheet-workspace__schema-footer">
        <Button
          label={labels.schemaAddColumn}
          icon={<Plus />}
          size="sm"
          variant="outline"
          onClick={addColumn}
        />
        <p className="spreadsheet-workspace__schema-hint">{labels.schemaColumnRefHint}</p>
      </footer>
    </div>
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
  const caption = `${labels.schemaColumnPosition} ${fallback} · ${
    column.refExplicit ? labels.schemaColumnExplicit : labels.schemaColumnImplicit
  }`;

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
    <li>
      <Card className="spreadsheet-workspace__schema-column-card">
        <p className="spreadsheet-workspace__schema-caption">{caption}</p>
        <FieldLabelRow label={labels.schemaColumnRef} htmlFor={refId}>
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
        <FieldLabelRow label={labels.schemaColumnName} htmlFor={nameId}>
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
        <FieldLabelRow label={labels.schemaColumnType} htmlFor={typeId}>
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
            <CurrencyField
              label={labels.schemaColumnCurrency}
              value={typeof column.currency === "string" ? column.currency : ""}
              placeholder="EUR"
              onCommit={(next) => onPatch({ currency: next || undefined })}
            />
            <CurrencyField
              label={labels.schemaColumnLocale}
              value={typeof column.locale === "string" ? column.locale : ""}
              placeholder="nl-NL"
              onCommit={(next) => onPatch({ locale: next || undefined })}
            />
          </>
        ) : null}
      </Card>
    </li>
  );
}

function CurrencyField({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (draft !== value) onCommit(draft);
  };

  return (
    <FieldLabelRow label={label}>
      <Input
        value={draft}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        }}
      />
    </FieldLabelRow>
  );
}
