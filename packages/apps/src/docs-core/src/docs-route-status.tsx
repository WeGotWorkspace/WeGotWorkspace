import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/button/src/button";
import { docsLabels } from "@/docs-core/src/docs-labels";
import type { DocsRouteDocument } from "@/docs-core/src/use-docs-route-document";
import "@/docs-core/src/docs-route-status.css";

type DocsRouteStatusProps = {
  document: Extract<DocsRouteDocument, { status: "resolving" | "not-found" }>;
  onRetry: () => void;
};

/** `/docs?id=` before the Doc opens: resolving, or an id that leads nowhere (#1751). */
export function DocsRouteStatus({ document, onRetry }: DocsRouteStatusProps) {
  const navigate = useNavigate();

  if (document.status === "resolving") {
    return (
      <p className="docs-route-status docs-route-status--loading" role="status">
        {docsLabels.documentOpening}
      </p>
    );
  }

  return (
    <div className="docs-route-status" role="alert">
      <p className="docs-route-status__title">{docsLabels.documentNotFoundTitle}</p>
      <p className="docs-route-status__description">
        {document.offline
          ? docsLabels.documentNotFoundOffline
          : docsLabels.documentNotFoundDescription}
      </p>
      <div className="docs-route-status__actions">
        <Button variant="outline" label={docsLabels.documentNotFoundRetry} onClick={onRetry} />
        <Button
          variant="primary"
          label={docsLabels.documentNotFoundBack}
          onClick={() => void navigate({ to: "/docs", search: {} })}
        />
      </div>
    </div>
  );
}
