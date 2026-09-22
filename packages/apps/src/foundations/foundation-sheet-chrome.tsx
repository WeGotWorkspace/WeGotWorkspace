import { useId, useState, type ReactNode } from "react";
import { copyText } from "./css-token-utils";

type FoundationSheetChromeProps = {
  title: string;
  description: string;
  filterPlaceholder?: string;
  filterValue: string;
  onFilterChange: (value: string) => void;
  children: ReactNode;
};

/**
 * Shared Soft/Dark page frame + sticky filter for Foundations token sheets.
 */
export function FoundationSheetChrome({
  title,
  description,
  filterPlaceholder = "Filter tokens…",
  filterValue,
  onFilterChange,
  children,
}: FoundationSheetChromeProps) {
  const filterId = useId();

  return (
    <div
      className="min-h-full font-sans text-[color:var(--color-we-got-dark)]"
      style={{
        backgroundColor: "var(--color-we-got-soft)",
        color: "var(--color-we-got-dark)",
      }}
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-8">
        <header className="flex flex-col gap-2">
          <h1
            className="text-4xl tracking-wide"
            style={{ fontFamily: "var(--font-mark)", fontWeight: 400 }}
          >
            {title}
          </h1>
          <p
            className="max-w-2xl text-sm leading-relaxed"
            style={{ color: "color-mix(in oklch, var(--color-we-got-dark) 68%, transparent)" }}
          >
            {description}
          </p>
        </header>

        <div
          className="sticky top-0 z-10 -mx-2 flex flex-col gap-1 px-2 py-3"
          style={{
            backgroundColor: "color-mix(in oklch, var(--color-we-got-soft) 92%, transparent)",
            backdropFilter: "blur(8px)",
          }}
        >
          <label
            htmlFor={filterId}
            className="text-xs font-medium uppercase"
            style={{ letterSpacing: "0.04em" }}
          >
            Filter
          </label>
          <input
            id={filterId}
            type="search"
            value={filterValue}
            onChange={(event) => onFilterChange(event.target.value)}
            placeholder={filterPlaceholder}
            className="w-full max-w-md rounded-[var(--control-radius)] border px-3 py-2 text-sm outline-none"
            style={{
              borderColor: "color-mix(in oklch, var(--color-we-got-dark) 14%, transparent)",
              backgroundColor: "var(--color-we-got-soft)",
              color: "var(--color-we-got-dark)",
              height: "var(--control-height-md)",
            }}
          />
        </div>

        {children}
      </div>
    </div>
  );
}

type TokenSectionProps = {
  title: string;
  note?: string;
  children: ReactNode;
};

export function TokenSection({ title, note, children }: TokenSectionProps) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-serif)" }}>
          {title}
        </h2>
        {note ? (
          <p
            className="text-sm leading-relaxed"
            style={{ color: "color-mix(in oklch, var(--color-we-got-dark) 62%, transparent)" }}
          >
            {note}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  );
}

type CopyRowProps = {
  label: string;
  copyValue: string;
  meta?: string;
  swatch?: ReactNode;
  sample?: ReactNode;
};

export function CopyTokenRow({ label, copyValue, meta, swatch, sample }: CopyRowProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const ok = await copyText(copyValue);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="group flex w-full items-center gap-3 rounded-[var(--control-radius)] border px-3 py-2.5 text-left transition-colors"
      style={{
        borderColor: "color-mix(in oklch, var(--color-we-got-dark) 10%, transparent)",
        backgroundColor: "color-mix(in oklch, var(--color-we-got-soft) 70%, white)",
      }}
      aria-label={`Copy ${copyValue}`}
    >
      {swatch}
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-xs sm:text-sm">{label}</span>
        {meta ? (
          <span
            className="mt-0.5 block truncate font-mono text-[0.7rem]"
            style={{ color: "color-mix(in oklch, var(--color-we-got-dark) 55%, transparent)" }}
          >
            {meta}
          </span>
        ) : null}
        {sample}
      </span>
      <span
        className="shrink-0 text-xs font-medium"
        style={{ color: "color-mix(in oklch, var(--color-we-got-dark) 55%, transparent)" }}
      >
        {copied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}

export function matchesFilter(haystack: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystack.toLowerCase().includes(q);
}
