import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { colLetter } from "@/spreadsheet-core/src/ycsv/ycsv";
import { FormulaTokens, useScrollSync } from "@/spreadsheet-core/src/formula-highlight";
import { buildFormulaDefContext } from "@/spreadsheet-core/src/spreadsheet-defs-utils";
import {
  buildFormulaSheetContext,
  computeSuggestions,
  type FormulaSheetInfo,
  SuggestionList,
} from "@/spreadsheet-core/src/formula-suggest";
import type { SpreadsheetController } from "@/spreadsheet-core/src/use-spreadsheet-controller";

export function SpreadsheetFormulaBar({ controller }: { controller: SpreadsheetController }) {
  const {
    labels,
    activeCell,
    activeRaw,
    columnSettings,
    defs,
    sheets,
    fbEditing,
    fbDraft,
    setFbDraft,
    fbCaret,
    setFbCaret,
    beginFormulaEdit,
    cancelFormulaEdit,
    commitFormulaBar,
    picking,
    selectionInfo,
    onPickingArrow,
  } = controller;

  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  useScrollSync(inputRef, overlayRef);

  const value = fbEditing ? fbDraft : activeRaw;

  const cellLabel = useMemo(() => {
    if (!activeCell) return "";
    const cs = columnSettings[activeCell.column];
    const letter =
      cs?.ref && /^[a-z][a-z0-9_]*$/.test(cs.ref) ? cs.ref : colLetter(activeCell.column);
    return `${letter}${activeCell.row + 1}`;
  }, [activeCell, columnSettings]);

  const formulaSheets = useMemo<FormulaSheetInfo[]>(
    () =>
      sheets.map((s) => ({
        ref: s.ref,
        name: s.name,
        columnSettings: s.columnSettings,
      })),
    [sheets],
  );
  const { sheetRefs, sheetColumnRefs } = useMemo(
    () => buildFormulaSheetContext(formulaSheets),
    [formulaSheets],
  );

  const { consts, mappingDefs } = useMemo(() => buildFormulaDefContext(defs), [defs]);
  const refs = useMemo(
    () => new Set(columnSettings.filter((c) => c.ref).map((c) => c.ref!)),
    [columnSettings],
  );

  const suggestions = useMemo(
    () =>
      fbEditing ? computeSuggestions(fbDraft, fbCaret, defs, columnSettings, formulaSheets) : [],
    [columnSettings, defs, fbCaret, fbDraft, fbEditing, formulaSheets],
  );
  useEffect(() => setActiveSuggestion(0), [suggestions.length]);

  // Keep the native caret in sync when picking inserts refs programmatically.
  useEffect(() => {
    if (!fbEditing) return;
    const el = inputRef.current;
    if (el && document.activeElement === el) {
      el.setSelectionRange(fbCaret, fbCaret);
    }
  }, [fbCaret, fbDraft, fbEditing]);

  const applySuggestion = (i: number) => {
    const s = suggestions[i];
    if (!s) return;
    const before = fbDraft.slice(0, fbCaret - s.tokenLen);
    const after = fbDraft.slice(fbCaret);
    const next = before + s.insert + after;
    setFbDraft(next);
    setFbCaret(before.length + s.insert.length);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const showSuggestions = fbEditing && suggestions.length > 0;
  const isFormula = value.startsWith("=");
  const showSelectionSummary = selectionInfo?.multi && !fbEditing;
  const addressLabel = selectionInfo?.label || cellLabel;

  return (
    <div
      className={cn(
        "spreadsheet-formula-bar",
        picking && "spreadsheet-formula-bar--picking",
        isFormula && "spreadsheet-formula-bar--formula",
      )}
    >
      <span className="spreadsheet-formula-bar__cell" aria-label="Selection address">
        {addressLabel || "—"}
      </span>
      <div className="spreadsheet-formula-bar__field">
        {showSelectionSummary ? (
          <div className="spreadsheet-formula-bar__selection">
            <span className="spreadsheet-formula-bar__selection-tag">selection</span>
            <span className="spreadsheet-formula-bar__selection-value">{selectionInfo.value}</span>
          </div>
        ) : (
          <>
            <FormulaTokens
              value={value}
              consts={consts}
              refs={refs}
              sheetRefs={sheetRefs}
              sheetColumnRefs={sheetColumnRefs}
              mappingDefs={mappingDefs}
              className="spreadsheet-formula-bar__tokens"
            />
            <input
              ref={inputRef}
              className={cn(
                "spreadsheet-formula-bar__input",
                isFormula && "spreadsheet-formula-bar__input--formula",
              )}
              value={value}
              placeholder={labels.formulaBarPlaceholder}
              disabled={!activeCell}
              spellCheck={false}
              onFocus={() => {
                if (!fbEditing) beginFormulaEdit();
              }}
              onChange={(e) => {
                if (!fbEditing) beginFormulaEdit();
                setFbDraft(e.target.value);
                setFbCaret(e.target.selectionStart ?? e.target.value.length);
              }}
              onClick={(e) => setFbCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
              onKeyUp={(e) => setFbCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
              onKeyDown={(e) => {
                if (picking && onPickingArrow && /^Arrow(Up|Down|Left|Right)$/.test(e.key)) {
                  e.preventDefault();
                  onPickingArrow(
                    e.key as "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
                    e.shiftKey,
                  );
                  return;
                }
                if (showSuggestions && !picking) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActiveSuggestion((i) => (i + 1) % suggestions.length);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActiveSuggestion((i) => (i - 1 + suggestions.length) % suggestions.length);
                    return;
                  }
                  if (e.key === "Tab") {
                    e.preventDefault();
                    applySuggestion(activeSuggestion);
                    return;
                  }
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (showSuggestions) applySuggestion(activeSuggestion);
                  else commitFormulaBar(fbDraft);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelFormulaEdit();
                  inputRef.current?.blur();
                }
              }}
            />
            {showSuggestions ? (
              <SuggestionList
                className="spreadsheet-formula-bar__suggest"
                suggestions={suggestions}
                activeIdx={activeSuggestion}
                onPick={applySuggestion}
                onHover={setActiveSuggestion}
              />
            ) : null}
          </>
        )}
      </div>
      {picking ? <span className="spreadsheet-formula-bar__hint">{labels.pickingHint}</span> : null}
    </div>
  );
}
