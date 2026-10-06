import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import "../workspace-shell/src/workspace-color.css";
import "../lib/workspace-app-icon.css";
import {
  CopyTokenRow,
  FoundationSheetChrome,
  TokenSection,
  matchesFilter,
} from "./foundation-sheet-chrome";
import { COLOR_COMPONENT_CONTRACT, COLOR_SEMANTIC, COLOR_WE_GOT_PRIMITIVES } from "./token-catalog";
import { formatCssVarRef, readCssVar, resolveCssColor } from "./css-token-utils";

type ColorRow = {
  token: string;
  cascaded: string;
  resolved: string;
};

function useResolvedColors(
  hostRef: RefObject<HTMLElement | null>,
  tokens: readonly string[],
): ColorRow[] {
  const [rows, setRows] = useState<ColorRow[]>([]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setRows(
      tokens.map((token) => ({
        token,
        cascaded: readCssVar(host, token),
        resolved: resolveCssColor(host, token),
      })),
    );
  }, [hostRef, tokens]);

  return rows;
}

function ColorSwatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="size-9 shrink-0 rounded-[var(--control-radius)] border"
      style={{
        backgroundColor: color || "transparent",
        borderColor: "color-mix(in oklch, var(--color-we-got-dark) 16%, transparent)",
        boxShadow: "inset 0 0 0 1px color-mix(in oklch, var(--color-we-got-dark) 6%, transparent)",
      }}
    />
  );
}

function ColorGroup({
  title,
  note,
  rows,
  filter,
}: {
  title: string;
  note?: string;
  rows: ColorRow[];
  filter: string;
}) {
  const visible = rows.filter(
    (row) =>
      matchesFilter(row.token, filter) ||
      matchesFilter(row.cascaded, filter) ||
      matchesFilter(row.resolved, filter),
  );
  if (visible.length === 0) return null;

  return (
    <TokenSection title={title} note={note}>
      {visible.map((row) => (
        <CopyTokenRow
          key={row.token}
          label={formatCssVarRef(row.token)}
          copyValue={formatCssVarRef(row.token)}
          meta={row.resolved || row.cascaded || "(unresolved)"}
          swatch={<ColorSwatch color={row.resolved || `var(${row.token})`} />}
        />
      ))}
    </TokenSection>
  );
}

/**
 * Interactive Foundations color catalog — values from computed style on a root
 * host (primitives / semantic) plus a shared workspace contract demo host.
 */
export function ColorsSheet() {
  const [filter, setFilter] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const contractRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<SVGSVGElement>(null);

  const primitiveRows = useResolvedColors(rootRef, COLOR_WE_GOT_PRIMITIVES);
  const semanticRows = useResolvedColors(rootRef, COLOR_SEMANTIC);

  const [contractRows, setContractRows] = useState<ColorRow[]>([]);
  const [iconRows, setIconRows] = useState<ColorRow[]>([]);

  useLayoutEffect(() => {
    const contractHost = contractRef.current;
    const iconHost = iconRef.current;
    if (!contractHost) return;

    const contractTokens = COLOR_COMPONENT_CONTRACT.filter(
      (t) => t !== "--workspace-icon-surface" && t !== "--workspace-icon-foreground",
    );
    const iconTokens = COLOR_COMPONENT_CONTRACT.filter(
      (t) => t === "--workspace-icon-surface" || t === "--workspace-icon-foreground",
    );

    setContractRows(
      contractTokens.map((token) => ({
        token,
        cascaded: readCssVar(contractHost, token),
        resolved: resolveCssColor(contractHost, token),
      })),
    );

    if (iconHost) {
      setIconRows(
        iconTokens.map((token) => ({
          token,
          cascaded: readCssVar(iconHost, token),
          resolved: resolveCssColor(iconHost, token),
        })),
      );
    }
  }, []);

  return (
    <FoundationSheetChrome
      title="Colors"
      description="Brand primitives, semantic roles, and the eight-token workspace core. Click a row to copy var(--…). Per-app brand remaps live under Themes — not here."
      filterValue={filter}
      onFilterChange={setFilter}
      filterPlaceholder="Filter by token or value…"
    >
      {/* Measurement root for suite tokens (inherits :root / @theme). */}
      <div
        ref={rootRef}
        aria-hidden
        className="pointer-events-none absolute size-px overflow-hidden opacity-0"
      />

      {/*
        Shared contract demo: core pairs + default switch-trigger brand layers
        (workspace-app-icon.css). Accent is a representative primitive; apps remap
        brand and icon layers under Themes.
      */}
      <div
        ref={contractRef}
        className="notes-workspace"
        style={
          {
            "--workspace-accent": "var(--color-we-got-brat)",
          } as CSSProperties
        }
      >
        <span className="workspace-app-icon--switch-trigger sr-only" aria-hidden>
          <svg ref={iconRef} viewBox="0 0 1 1" width="1" height="1" />
        </span>
      </div>

      <ColorGroup
        title="Primitives"
        note="We Got --color-we-got-* source hues."
        rows={primitiveRows}
        filter={filter}
      />
      <ColorGroup
        title="Semantic"
        note="Status roles (error ≠ We Got Red). Brand hues stay in Primitives."
        rows={semanticRows}
        filter={filter}
      />
      <ColorGroup
        title="Workspace core"
        note="The eight surface/foreground pairs plus derived chrome. Per-app brand values are remapped in Themes stories."
        rows={[...contractRows, ...iconRows]}
        filter={filter}
      />
    </FoundationSheetChrome>
  );
}
