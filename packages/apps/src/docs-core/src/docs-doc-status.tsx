import type { ComponentProps } from "react";

export type DocsDocStatusProps = Omit<ComponentProps<"span">, "children"> & {
  status: string;
  /** Machine-readable state behind the copy, for styling and for tests. */
  kind?: string;
};

/** Spreads the rest onto the span so a Radix `asChild` trigger can reach the DOM node. */
export function DocsDocStatus({ status, kind, className, ...rest }: DocsDocStatusProps) {
  return (
    <span
      {...rest}
      className={
        className ? `docs-workspace__doc-status ${className}` : "docs-workspace__doc-status"
      }
      role="status"
      aria-live="polite"
      data-doc-status-kind={kind}
    >
      {status}
    </span>
  );
}
