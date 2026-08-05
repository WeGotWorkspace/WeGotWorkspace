import { Share2 } from "lucide-react";
import { Button } from "@/button/src/button";
import { CollectionSearchInput } from "@/collection-search-input/src/collection-search-input";
import { PathBreadcrumb } from "@/path-breadcrumb/src/path-breadcrumb";
import { DriveViewIcon } from "@/drive-core/src/drive-view-icons";
import { DriveAccessFilters } from "@/drive-core/src/drive-access-filters";
import { DriveAccessGrantRow } from "@/drive-core/src/drive-access-grant-row";
import type { DriveAccessController } from "@/drive-core/src/use-drive-access-controller";

type DriveAccessDetailProps = {
  controller: DriveAccessController;
};

export function DriveAccessDetail({ controller }: DriveAccessDetailProps) {
  const {
    labels,
    scopePath,
    breadcrumbs,
    navigateScopeFromBreadcrumb,
    displayRows,
    atPath,
    atPathLoading,
    query,
    setQuery,
    revokeAllPublic,
    revokeLoading,
    manageShare,
  } = controller;

  const scopeTitle = breadcrumbs[breadcrumbs.length - 1]?.label ?? scopePath;
  const hasPublicShares = (atPath?.publicShares.length ?? 0) > 0;

  return (
    <section className="drive-access-detail" aria-labelledby="drive-access-detail-title">
      <div className="drive-access-detail__header">
        <PathBreadcrumb
          items={breadcrumbs}
          currentPath={scopePath}
          onNavigate={navigateScopeFromBreadcrumb}
          leadingIcon={<DriveViewIcon view={{ type: "folder", path: scopePath }} />}
          size="sm"
        />
        <h2 id="drive-access-detail-title" className="drive-access-detail__title">
          {scopeTitle}
        </h2>
      </div>

      <div className="drive-access-detail__actions">
        {hasPublicShares ? (
          <Button
            label={labels.accessRevokeAllPublic}
            variant="subtle"
            size="sm"
            onClick={() => void revokeAllPublic()}
            disabled={revokeLoading}
          />
        ) : null}
        <Button
          label={labels.accessManageShare}
          icon={<Share2 className="size-4" aria-hidden />}
          variant="primary"
          size="sm"
          onClick={manageShare}
          disabled={atPath?.myRights.mayShare !== true}
        />
      </div>

      <div className="drive-access-detail__toolbar">
        <div className="drive-access-detail__search">
          <CollectionSearchInput
            value={query}
            onChange={setQuery}
            placeholder={labels.accessSearchPlaceholder}
          />
        </div>
        <DriveAccessFilters controller={controller} />
      </div>

      <div className="drive-access-detail__rows" aria-busy={atPathLoading}>
        {atPathLoading ? (
          <p className="drive-access-detail__status">{labels.accessLoading}</p>
        ) : null}
        {!atPathLoading && displayRows.length === 0 ? (
          <p className="drive-access-detail__status">{labels.accessNoGrants}</p>
        ) : null}
        {!atPathLoading
          ? displayRows.map((row, index) => (
              <DriveAccessGrantRow
                key={
                  row.kind === "public"
                    ? `public-${row.entry.shareId}`
                    : `${row.entry.principal}-${row.entry.source.shareId}-${index}`
                }
                row={row}
                controller={controller}
              />
            ))
          : null}
      </div>
    </section>
  );
}
