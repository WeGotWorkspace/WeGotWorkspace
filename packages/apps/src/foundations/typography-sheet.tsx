import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import "../workspace-shell/src/workspace-type.css";
import {
  CopyTokenRow,
  FoundationSheetChrome,
  TokenSection,
  matchesFilter,
} from "./foundation-sheet-chrome";
import {
  FONT_PRIMITIVES,
  FONT_SEMANTIC,
  FONT_WEIGHT_UTILITIES,
  TEXT_SIZE_STEPS,
  TYPE_ROLE_UTILITIES,
} from "./token-catalog";
import { formatCssVarRef, readCssVar, resolveFontFamily, resolveFontSize } from "./css-token-utils";

type FontRow = {
  token: string;
  cascaded: string;
  resolved: string;
};

function useFontRows(hostRef: RefObject<HTMLElement | null>, tokens: readonly string[]): FontRow[] {
  const [rows, setRows] = useState<FontRow[]>([]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setRows(
      tokens.map((token) => ({
        token,
        cascaded: readCssVar(host, token),
        resolved: resolveFontFamily(host, token),
      })),
    );
  }, [hostRef, tokens]);

  return rows;
}

/**
 * Interactive Foundations typography catalog — faces, role utilities, size
 * steps, and the weight utilities this repo actually uses.
 */
export function TypographySheet() {
  const [filter, setFilter] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const primitiveRows = useFontRows(rootRef, FONT_PRIMITIVES);
  const semanticRows = useFontRows(rootRef, FONT_SEMANTIC);

  const [sizeRows, setSizeRows] = useState<{ token: string; cascaded: string; px: string }[]>([]);
  const [weightRows, setWeightRows] = useState<
    { className: string; label: string; token: string; value: string }[]
  >([]);

  useLayoutEffect(() => {
    const host = rootRef.current;
    if (!host) return;
    setSizeRows(
      TEXT_SIZE_STEPS.map((token) => ({
        token,
        cascaded: readCssVar(host, token),
        px: resolveFontSize(host, token),
      })),
    );
    setWeightRows(
      FONT_WEIGHT_UTILITIES.map((item) => ({
        ...item,
        value: readCssVar(host, item.token),
      })),
    );
  }, []);

  return (
    <FoundationSheetChrome
      title="Typography"
      description="Font primitives and semantic roles, shared @utility type roles, Tailwind size steps used by those roles, and font-medium / font-semibold. Mark renders as Bebas Neue."
      filterValue={filter}
      onFilterChange={setFilter}
      filterPlaceholder="Filter faces, roles, or sizes…"
    >
      <div
        ref={rootRef}
        aria-hidden
        className="pointer-events-none absolute size-px overflow-hidden opacity-0"
      />

      <TokenSection
        title="Font families"
        note="Primitives first, then semantic roles (font-sans / font-serif / font-mono / font-mark)."
      >
        {[...primitiveRows, ...semanticRows]
          .filter(
            (row) =>
              matchesFilter(row.token, filter) ||
              matchesFilter(row.cascaded, filter) ||
              matchesFilter(row.resolved, filter),
          )
          .map((row) => (
            <CopyTokenRow
              key={row.token}
              label={formatCssVarRef(row.token)}
              copyValue={formatCssVarRef(row.token)}
              meta={row.resolved || row.cascaded}
              sample={
                <span
                  className="mt-1 block text-lg leading-snug"
                  style={{ fontFamily: `var(${row.token})` } as CSSProperties}
                >
                  The quick brown fox — 0123456789
                </span>
              }
            />
          ))}
      </TokenSection>

      <TokenSection
        title="Type roles"
        note="Shared @utility classes from workspace-type.css (text-title, text-title-lg, text-caption, text-lockup)."
      >
        {TYPE_ROLE_UTILITIES.filter(
          (role) =>
            matchesFilter(role.className, filter) ||
            matchesFilter(role.label, filter) ||
            matchesFilter(role.sample, filter),
        ).map((role) => (
          <CopyTokenRow
            key={role.className}
            label={`.${role.className}`}
            copyValue={role.className}
            meta={role.label}
            sample={<span className={`mt-1 block ${role.className}`}>{role.sample}</span>}
          />
        ))}
      </TokenSection>

      <TokenSection
        title="Size steps"
        note="Tailwind --text-* steps referenced by shared roles (xs through 4xl). Caption leading stays on .text-caption only — do not set --text-xs--line-height."
      >
        {sizeRows
          .filter(
            (row) =>
              matchesFilter(row.token, filter) ||
              matchesFilter(row.cascaded, filter) ||
              matchesFilter(row.px, filter),
          )
          .map((row) => (
            <CopyTokenRow
              key={row.token}
              label={formatCssVarRef(row.token)}
              copyValue={formatCssVarRef(row.token)}
              meta={`${row.cascaded || "—"} → ${row.px}`}
              sample={
                <span className="mt-1 block leading-none" style={{ fontSize: `var(${row.token})` }}>
                  Aa
                </span>
              }
            />
          ))}
      </TokenSection>

      <TokenSection title="Weight" note="Only the weight utilities this product chrome uses.">
        {weightRows
          .filter(
            (row) =>
              matchesFilter(row.className, filter) ||
              matchesFilter(row.label, filter) ||
              matchesFilter(row.token, filter),
          )
          .map((row) => (
            <CopyTokenRow
              key={row.className}
              label={`.${row.className}`}
              copyValue={row.className}
              meta={`${formatCssVarRef(row.token)} → ${row.value || "—"}`}
              sample={
                <span className={`mt-1 block text-base ${row.className}`}>
                  {row.label} — The quick brown fox
                </span>
              }
            />
          ))}
      </TokenSection>
    </FoundationSheetChrome>
  );
}
