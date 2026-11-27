import { useLayoutEffect, useMemo, useState, type RefObject } from "react";
import type { Theme } from "@glideapps/glide-data-grid";

/** Fallbacks mirror `.spreadsheet-workspace` accent tokens when CSS vars are unavailable. */
const FALLBACK = {
  accent: "#0d9488",
  accentLight: "rgb(230, 247, 245)",
  accentBadgeBg: "rgba(13, 148, 136, 0.15)",
  accentBadgeFg: "rgb(15, 118, 110)",
  textHeaderSelected: "#0d9488",
} as const;

export type SpreadsheetGridThemeTokens = {
  accent: string;
  accentLight: string;
  accentBadgeBg: string;
  accentBadgeFg: string;
  textHeaderSelected: string;
};

function resolveVarColor(host: HTMLElement, varName: string, fallback: string): string {
  const probe = document.createElement("span");
  probe.style.setProperty("position", "absolute");
  probe.style.setProperty("visibility", "hidden");
  probe.style.setProperty("background-color", `var(${varName})`);
  host.appendChild(probe);
  const color = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return color && color !== "rgba(0, 0, 0, 0)" ? color : fallback;
}

function readTokens(host: HTMLElement | null): SpreadsheetGridThemeTokens {
  if (!host) return { ...FALLBACK };
  const closest = host.closest(".spreadsheet-workspace");
  const root = closest instanceof HTMLElement ? closest : host;
  return {
    accent: resolveVarColor(root, "--spreadsheet-accent", FALLBACK.accent),
    accentLight: resolveVarColor(root, "--spreadsheet-grid-accent-light", FALLBACK.accentLight),
    accentBadgeBg: resolveVarColor(
      root,
      "--spreadsheet-grid-accent-badge-bg",
      FALLBACK.accentBadgeBg,
    ),
    accentBadgeFg: resolveVarColor(
      root,
      "--spreadsheet-grid-accent-badge-fg",
      FALLBACK.accentBadgeFg,
    ),
    textHeaderSelected: resolveVarColor(root, "--spreadsheet-accent", FALLBACK.textHeaderSelected),
  };
}

/** Resolve spreadsheet accent tokens from workspace CSS for Glide canvas rendering. */
export function useSpreadsheetGridTheme(containerRef: RefObject<HTMLElement | null>) {
  const [tokens, setTokens] = useState<SpreadsheetGridThemeTokens>({ ...FALLBACK });

  useLayoutEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    const sync = () => setTokens(readTokens(host));
    sync();

    const closest = host.closest(".spreadsheet-workspace");
    const root = closest instanceof HTMLElement ? closest : host;
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class", "style"] });
    return () => observer.disconnect();
  }, [containerRef]);

  return useMemo(() => {
    const glideTheme: Partial<Theme> = {
      accentColor: tokens.accent,
      accentLight: tokens.accentLight,
      accentFg: "#ffffff",
      textHeaderSelected: tokens.textHeaderSelected,
    };
    return { tokens, glideTheme };
  }, [tokens]);
}
