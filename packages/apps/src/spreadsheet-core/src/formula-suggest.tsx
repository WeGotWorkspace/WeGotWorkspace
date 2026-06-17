import { cn } from "@/lib/utils";
import { getMappingDef } from "@/spreadsheet-core/src/spreadsheet-defs-utils";
import { FORMULA_FUNCTIONS } from "@/spreadsheet-core/src/ycsv/ycsv-formula-engine";
import type { ColumnSetting, Defs } from "@/spreadsheet-core/src/ycsv/ycsv";

/** "Open" formula context: the cursor is awaiting a reference. */
export const OPEN_TOKEN_RE = /[=+\-*/^&,(:<>!%]\s*$/;

export type FormulaSheetInfo = {
  ref: string;
  name: string;
  columnSettings: ColumnSetting[];
};

export function buildFormulaSheetContext(sheets: FormulaSheetInfo[]) {
  const sheetRefs = new Set(sheets.map((s) => s.ref.toLowerCase()));
  const sheetColumnRefs = new Map<string, Set<string>>();
  for (const sheet of sheets) {
    sheetColumnRefs.set(
      sheet.ref.toLowerCase(),
      new Set(sheet.columnSettings.filter((c) => c.ref).map((c) => c.ref!.toLowerCase())),
    );
  }
  return { sheetRefs, sheetColumnRefs };
}

export type Suggestion = {
  kind: "fn" | "def" | "defkey" | "ref" | "sheet";
  label: string;
  detail: string;
  insert: string;
  tokenLen: number;
};

function defDetail(value: Defs[string]): string {
  if (Array.isArray(value)) return `list (${value.length})`;
  if (value && typeof value === "object") return `mapping (${Object.keys(value).length})`;
  return `= ${value}`;
}

function findSheet(sheets: FormulaSheetInfo[], partial: string): FormulaSheetInfo | undefined {
  const lower = partial.toLowerCase();
  return sheets.find((s) => s.ref.toLowerCase() === lower);
}

function sheetSuggestions(
  sheets: FormulaSheetInfo[],
  token: string,
  tokenLen: number,
): Suggestion[] {
  if (sheets.length <= 1) return [];
  const tl = token.toLowerCase();
  return sheets
    .filter((s) => s.ref.toLowerCase().startsWith(tl) || s.name.toLowerCase().startsWith(tl))
    .slice(0, 6)
    .map((s) => ({
      kind: "sheet" as const,
      label: s.ref,
      detail: s.name !== s.ref ? s.name : "sheet",
      insert: `${s.ref}!`,
      tokenLen,
    }));
}

function columnSuggestions(
  columnSettings: ColumnSetting[],
  token: string,
  tokenLen: number,
  detailPrefix?: string,
): Suggestion[] {
  const tl = token.toLowerCase();
  return columnSettings
    .filter((c) => c.ref && c.ref.toLowerCase().startsWith(tl))
    .slice(0, 8)
    .map((c) => ({
      kind: "ref" as const,
      label: c.ref!,
      detail: detailPrefix ? `${detailPrefix}: ${c.name ?? c.ref}` : `column ${c.name ?? c.ref}`,
      insert: c.ref!,
      tokenLen,
    }));
}

type SuggestContext =
  | { mode: "open" }
  | { mode: "ident"; token: string }
  | { mode: "sheetColumn"; sheetRef: string; token: string }
  | { mode: "defKey"; defName: string; token: string };

function analyzeContext(upTo: string): SuggestContext {
  const justOpened = /^(=|[+\-*/^&,(:<>!%]\s*)$/.test(upTo.trimEnd());
  if (justOpened) return { mode: "open" };

  const sheetColMatch = upTo.match(/([a-z][a-z0-9_]*)!([a-z][a-z0-9_]*)$/i);
  if (sheetColMatch) {
    return { mode: "sheetColumn", sheetRef: sheetColMatch[1], token: sheetColMatch[2] };
  }

  const sheetBangMatch = upTo.match(/([a-z][a-z0-9_]*)!$/i);
  if (sheetBangMatch) {
    return { mode: "sheetColumn", sheetRef: sheetBangMatch[1], token: "" };
  }

  const defKeyPartial = upTo.match(/([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/i);
  if (defKeyPartial) {
    return { mode: "defKey", defName: defKeyPartial[1], token: defKeyPartial[2] };
  }

  const defKeyOpen = upTo.match(/([a-z][a-z0-9_]*)\.$/i);
  if (defKeyOpen) {
    return { mode: "defKey", defName: defKeyOpen[1], token: "" };
  }

  const m = upTo.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
  if (!m) return { mode: "open" };
  return { mode: "ident", token: m[1] };
}

function defKeySuggestions(
  defs: Defs,
  defName: string,
  token: string,
  tokenLen: number,
): Suggestion[] {
  const mapping = getMappingDef(defs, defName);
  if (!mapping) return [];
  const tl = token.toLowerCase();
  const canonicalName =
    Object.keys(defs).find((k) => k.toLowerCase() === defName.toLowerCase()) ?? defName;
  return Object.entries(mapping)
    .filter(([key]) => key.toLowerCase().startsWith(tl))
    .slice(0, 8)
    .map(([key, label]) => ({
      kind: "defkey" as const,
      label: tokenLen > 0 ? key : `${canonicalName}.${key}`,
      detail: label,
      insert: key,
      tokenLen,
    }));
}

export function computeSuggestions(
  draft: string,
  caret: number,
  defs: Defs,
  columnSettings: ColumnSetting[],
  sheets: FormulaSheetInfo[] = [],
): Suggestion[] {
  if (!draft.startsWith("=")) return [];
  const upTo = draft.slice(0, caret);
  const ctx = analyzeContext(upTo);

  if (ctx.mode === "sheetColumn") {
    const sheet = findSheet(sheets, ctx.sheetRef);
    if (!sheet) return [];
    return columnSuggestions(sheet.columnSettings, ctx.token, ctx.token.length, sheet.name);
  }

  if (ctx.mode === "defKey") {
    return defKeySuggestions(defs, ctx.defName, ctx.token, ctx.token.length);
  }

  if (ctx.mode === "open") {
    const fns: Suggestion[] = FORMULA_FUNCTIONS.slice(0, 6).map((f) => ({
      kind: "fn",
      label: f.name,
      detail: f.signature,
      insert: f.name + "(",
      tokenLen: 0,
    }));
    const defSuggestions: Suggestion[] = Object.keys(defs).map((n) => ({
      kind: "def",
      label: n,
      detail: defDetail(defs[n]),
      insert: n,
      tokenLen: 0,
    }));
    const refs: Suggestion[] = columnSettings
      .filter((c) => c.ref && /^[a-z][a-z0-9_]*$/.test(c.ref))
      .slice(0, 6)
      .map((c) => ({
        kind: "ref",
        label: c.ref!,
        detail: `column ${c.name ?? c.ref}`,
        insert: c.ref!,
        tokenLen: 0,
      }));
    const sheetsOpen = sheetSuggestions(sheets, "", 0);
    return [...sheetsOpen, ...defSuggestions, ...fns, ...refs];
  }

  const token = ctx.token;
  if (token.length < 1) return [];
  const tu = token.toUpperCase();
  const tl = token.toLowerCase();
  const fns: Suggestion[] = FORMULA_FUNCTIONS.filter((f) => f.name.startsWith(tu))
    .slice(0, 6)
    .map((f) => ({
      kind: "fn",
      label: f.name,
      detail: f.signature,
      insert: f.name + "(",
      tokenLen: token.length,
    }));
  const defMatches: Suggestion[] = Object.keys(defs)
    .filter((n) => n.toUpperCase().startsWith(tu))
    .slice(0, 6)
    .map((n) => ({
      kind: "def",
      label: n,
      detail: defDetail(defs[n]),
      insert: n,
      tokenLen: token.length,
    }));
  const refMatches: Suggestion[] = columnSettings
    .filter((c) => c.ref && c.ref.toLowerCase().startsWith(tl))
    .slice(0, 4)
    .map((c) => ({
      kind: "ref",
      label: c.ref!,
      detail: `column ${c.name ?? c.ref}`,
      insert: c.ref!,
      tokenLen: token.length,
    }));
  const sheetMatches = sheetSuggestions(sheets, token, token.length);
  return [...sheetMatches, ...defMatches, ...fns, ...refMatches];
}

export function SuggestionList({
  suggestions,
  activeIdx,
  onPick,
  onHover,
  className,
}: {
  suggestions: Suggestion[];
  activeIdx: number;
  onPick: (i: number) => void;
  onHover: (i: number) => void;
  className?: string;
}) {
  return (
    <div className={cn("spreadsheet-suggest", className)}>
      {suggestions.map((s, i) => (
        <button
          key={`${s.kind}-${s.label}-${i}`}
          type="button"
          data-suggestion-index={i}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(i);
          }}
          onMouseEnter={() => onHover(i)}
          className={cn(
            "spreadsheet-suggest__item",
            i === activeIdx && "spreadsheet-suggest__item--active",
          )}
        >
          <span className="spreadsheet-suggest__label">
            <span
              className={cn("spreadsheet-suggest__kind", `spreadsheet-suggest__kind--${s.kind}`)}
            >
              {s.kind === "ref" ? "col" : s.kind === "defkey" ? "key" : s.kind}
            </span>
            <span className="spreadsheet-suggest__name">{s.label}</span>
          </span>
          <span className="spreadsheet-suggest__detail">{s.detail}</span>
        </button>
      ))}
    </div>
  );
}
