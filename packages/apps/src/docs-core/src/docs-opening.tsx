import { CollectionState } from "@/collection-state/src/collection-state";
import { docsLabels } from "@/docs-core/src/docs-labels";

/**
 * The Doc is joining its room, or its text is still on its way (#2056): the
 * suite's loading block, instead of an empty sheet that would take typing.
 */
export function DocsOpening() {
  return (
    <div className="docs-workspace__opening collection-state-host">
      <CollectionState variant="loading">{docsLabels.documentOpening}</CollectionState>
    </div>
  );
}
