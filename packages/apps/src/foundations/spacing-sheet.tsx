import { useLayoutEffect, useRef, useState } from "react";
import {
  CopyTokenRow,
  FoundationSheetChrome,
  TokenSection,
  matchesFilter,
} from "./foundation-sheet-chrome";
import { CONTROL_SIZE_TOKENS, SPACING_SCALE_STEPS } from "./token-catalog";
import { formatCssVarRef, readCssVar, resolveLengthPx } from "./css-token-utils";

type SpacingStepRow = {
  step: number;
  utility: string;
  expression: string;
  px: string;
};

type TokenSizeRow = {
  token: string;
  cascaded: string;
  px: string;
};

/**
 * Interactive Foundations spacing catalog — Tailwind --spacing scale plus
 * control height / padding tokens from styles.css.
 */
export function SpacingSheet() {
  const [filter, setFilter] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const [unit, setUnit] = useState("");
  const [scaleRows, setScaleRows] = useState<SpacingStepRow[]>([]);
  const [controlRows, setControlRows] = useState<TokenSizeRow[]>([]);

  useLayoutEffect(() => {
    const host = rootRef.current;
    if (!host) return;

    const spacingUnit = readCssVar(host, "--spacing");
    setUnit(spacingUnit);

    setScaleRows(
      SPACING_SCALE_STEPS.map((step) => {
        const expression = step === 0 ? "0px" : `calc(var(--spacing) * ${step})`;
        return {
          step,
          utility: step === 0 ? "0" : String(step),
          expression,
          px: resolveLengthPx(host, expression),
        };
      }),
    );

    setControlRows(
      CONTROL_SIZE_TOKENS.map((token) => ({
        token,
        cascaded: readCssVar(host, token),
        px: resolveLengthPx(host, `var(${token})`),
      })),
    );
  }, []);

  const maxPx = Math.max(
    1,
    ...scaleRows.map((row) => Number.parseFloat(row.px) || 0),
    ...controlRows.map((row) => Number.parseFloat(row.px) || 0),
  );

  return (
    <FoundationSheetChrome
      title="Spacing"
      description={`Tailwind spacing unit ${unit ? `(--spacing: ${unit})` : ""} and control size tokens. Bars show computed pixels. Click a row to copy.`}
      filterValue={filter}
      onFilterChange={setFilter}
      filterPlaceholder="Filter steps or tokens…"
    >
      <div
        ref={rootRef}
        aria-hidden
        className="pointer-events-none absolute size-px overflow-hidden opacity-0"
      />

      <TokenSection
        title="Spacing scale"
        note="Default Tailwind theme: width/padding/gap steps as calc(var(--spacing) * n). No custom --spacing-* overrides in this repo."
      >
        {scaleRows
          .filter(
            (row) =>
              matchesFilter(String(row.step), filter) ||
              matchesFilter(row.utility, filter) ||
              matchesFilter(row.expression, filter) ||
              matchesFilter(row.px, filter) ||
              matchesFilter("--spacing", filter),
          )
          .map((row) => {
            const widthPct = Math.min(100, ((Number.parseFloat(row.px) || 0) / maxPx) * 100);
            return (
              <CopyTokenRow
                key={row.utility}
                label={row.step === 0 ? "0" : `${row.utility} · ${row.expression}`}
                copyValue={row.step === 0 ? "0" : `calc(var(--spacing) * ${row.step})`}
                meta={row.px}
                swatch={
                  <span
                    aria-hidden
                    className="relative block h-3 w-16 shrink-0 overflow-hidden rounded-sm"
                    style={{
                      backgroundColor: "color-mix(in oklch, var(--color-ink) 8%, transparent)",
                    }}
                  >
                    <span
                      className="absolute inset-y-0 left-0 rounded-sm"
                      style={{
                        width: `${widthPct}%`,
                        backgroundColor: "color-mix(in oklch, var(--color-ink) 28%, transparent)",
                      }}
                    />
                  </span>
                }
              />
            );
          })}
      </TokenSection>

      <TokenSection
        title="Control sizes"
        note="Fixed control height scale and horizontal input padding from styles.css :root."
      >
        {controlRows
          .filter(
            (row) =>
              matchesFilter(row.token, filter) ||
              matchesFilter(row.cascaded, filter) ||
              matchesFilter(row.px, filter),
          )
          .map((row) => {
            const heightPx = Number.parseFloat(row.px) || 0;
            return (
              <CopyTokenRow
                key={row.token}
                label={formatCssVarRef(row.token)}
                copyValue={formatCssVarRef(row.token)}
                meta={`${row.cascaded || "—"} → ${row.px}`}
                swatch={
                  <span
                    aria-hidden
                    className="w-10 shrink-0 rounded-[var(--control-radius)]"
                    style={{
                      height: `var(${row.token})`,
                      minHeight: "0.5rem",
                      maxHeight: "3.5rem",
                      backgroundColor: "color-mix(in oklch, var(--color-ink) 22%, transparent)",
                      // padding-x token is a width, not height — show as bar width instead
                      ...(row.token.includes("padding")
                        ? {
                            height: "0.75rem",
                            width: Math.min(40, heightPx || 12),
                          }
                        : {}),
                    }}
                  />
                }
              />
            );
          })}
      </TokenSection>
    </FoundationSheetChrome>
  );
}
