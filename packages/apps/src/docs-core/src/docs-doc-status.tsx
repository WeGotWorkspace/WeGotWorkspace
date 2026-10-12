export type DocsDocStatusProps = {
  status: string;
  /** Machine-readable state behind the copy, for styling and for tests. */
  kind?: string;
};

export function DocsDocStatus({ status, kind }: DocsDocStatusProps) {
  return (
    <span
      className="docs-workspace__doc-status"
      role="status"
      aria-live="polite"
      data-doc-status-kind={kind}
    >
      {status}
    </span>
  );
}
