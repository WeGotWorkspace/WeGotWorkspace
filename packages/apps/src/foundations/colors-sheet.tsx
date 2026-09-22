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
        borderColor: "color-mix(in oklch, var(--color-ink) 16%, transparent)",
        boxShadow: "inset 0 0 0 1px color-mix(in oklch, var(--color-ink) 6%, transparent)",
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
          swatch={
            row.token === "--workspace-sidebar-mix" ? (
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-[var(--control-radius)] border font-mono text-[0.65rem]"
                style={{
                  borderColor: "color-mix(in oklch, var(--color-ink) 16%, transparent)",
                }}
              >
                %
              </span>
            ) : (
              <ColorSwatch color={row.resolved || `var(${row.token})`} />
            )
          }
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
  const waiRef = useRef<SVGSVGElement>(null);

  const primitiveRows = useResolvedColors(rootRef, COLOR_WE_GOT_PRIMITIVES);
  const semanticRows = useResolvedColors(rootRef, COLOR_SEMANTIC);

  const [contractRows, setContractRows] = useState<ColorRow[]>([]);
  const [waiRows, setWaiRows] = useState<ColorRow[]>([]);

  useLayoutEffect(() => {
    const contractHost = contractRef.current;
    const waiHost = waiRef.current;
    if (!contractHost) return;

    const contractTokens = COLOR_COMPONENT_CONTRACT.filter((t) => !t.startsWith("--wai-"));
    const waiTokens = COLOR_COMPONENT_CONTRACT.filter((t) => t.startsWith("--wai-"));

    setContractRows(
      contractTokens.map((token) => ({
        token,
        cascaded: readCssVar(contractHost, token),
        resolved:
          token === "--workspace-sidebar-mix"
            ? readCssVar(contractHost, token)
            : resolveCssColor(contractHost, token),
      })),
    );

    if (waiHost) {
      setWaiRows(
        waiTokens.map((token) => ({
          token,
          cascaded: readCssVar(waiHost, token),
          resolved: resolveCssColor(waiHost, token),
        })),
      );
    }
  }, []);

  return (
    <FoundationSheetChrome
      title="Colors"
      description="Brand primitives, semantic roles, and the shared workspace component contract. Click a row to copy var(--…). Per-app accent / --wai-* remaps live under Themes — not here."
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
        Shared contract demo: workspace-color.css recipes + default switch-trigger
        --wai-* (workspace-app-icon.css). Accent is a representative brand primitive;
        apps remap accent and icon layers under Themes.
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
          <svg ref={waiRef} viewBox="0 0 1 1" width="1" height="1" />
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
        note="Ink / cream aliases plus status roles (error ≠ We Got Red)."
        rows={semanticRows}
        filter={filter}
      />
      <ColorGroup
        title="Component contract"
        note="Shared workspace-color.css recipe with a demo --workspace-accent. Per-app values (sidebar mix, primary, icon layers) are remapped in Themes stories."
        rows={[...contractRows, ...waiRows]}
        filter={filter}
      />
    </FoundationSheetChrome>
  );
}
