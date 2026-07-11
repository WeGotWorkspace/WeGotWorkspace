import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import { cn } from "@/lib/utils";
import { DriveViewIcon } from "@/drive-core/src/drive-view-icons";
import type { DriveAccessController } from "@/drive-core/src/use-drive-access-controller";

type DriveAccessTreeProps = {
  controller: DriveAccessController;
};

function TreeRow({
  label,
  uiPath: _uiPath,
  depth,
  selected,
  expanded,
  expandable,
  loading,
  onSelect,
  onToggle,
  icon,
}: {
  label: string;
  uiPath: string;
  depth: number;
  selected: boolean;
  expanded: boolean;
  expandable: boolean;
  loading?: boolean;
  onSelect: () => void;
  onToggle: () => void;
  icon: ReactNode;
}) {
  return (
    <div className="drive-access-tree__row" style={{ paddingLeft: `${depth * 0.75 + 0.5}rem` }}>
      <button
        type="button"
        className={cn(
          "drive-access-tree__expand",
          !expandable && "drive-access-tree__expand--placeholder",
        )}
        onClick={expandable ? onToggle : undefined}
        tabIndex={expandable ? 0 : -1}
        aria-hidden={!expandable}
        aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
      >
        {expandable ? (
          expanded ? (
            <ChevronDown className="size-3.5" aria-hidden />
          ) : (
            <ChevronRight className="size-3.5" aria-hidden />
          )
        ) : null}
      </button>
      <button
        type="button"
        className={cn("drive-access-tree__item", selected && "drive-access-tree__item--selected")}
        onClick={onSelect}
        aria-current={selected ? "location" : undefined}
      >
        <span className="drive-access-tree__icon" aria-hidden>
          {icon}
        </span>
        <span className="drive-access-tree__label">{label}</span>
        {loading ? <span className="drive-access-tree__loading">…</span> : null}
      </button>
    </div>
  );
}

function TreeBranch({
  controller,
  uiPath,
  label,
  depth,
  isRoot = false,
}: {
  controller: DriveAccessController;
  uiPath: string;
  label: string;
  depth: number;
  isRoot?: boolean;
}) {
  const { scopePath, setScopePath, expandedPaths, toggleExpanded, treeChildren, treeLoadingPaths } =
    controller;

  const expanded = expandedPaths.has(uiPath);
  const children = treeChildren[uiPath] ?? [];
  const loading = treeLoadingPaths.has(uiPath);
  const selected = scopePath === uiPath || scopePath.startsWith(`${uiPath}/`);

  const icon = isRoot ? (
    <DriveViewIcon view={{ type: "folder", path: uiPath }} className="size-3.5" />
  ) : (
    <Folder className="size-3.5" aria-hidden />
  );

  return (
    <>
      <TreeRow
        label={label}
        uiPath={uiPath}
        depth={depth}
        selected={scopePath === uiPath}
        expanded={expanded}
        expandable
        loading={loading && expanded}
        onSelect={() => setScopePath(uiPath)}
        onToggle={() => toggleExpanded(uiPath)}
        icon={icon}
      />
      {expanded
        ? children.map((child) => (
            <TreeBranch
              key={child.uiPath}
              controller={controller}
              uiPath={child.uiPath}
              label={child.name}
              depth={depth + 1}
            />
          ))
        : null}
      {expanded && !loading && children.length === 0 ? (
        <p
          className="drive-access-tree__empty"
          style={{ paddingLeft: `${(depth + 1) * 0.75 + 2}rem` }}
        >
          No subfolders
        </p>
      ) : null}
      {!isRoot && selected && scopePath !== uiPath ? (
        <span className="sr-only">Ancestor of current scope</span>
      ) : null}
    </>
  );
}

export function DriveAccessTree({ controller }: DriveAccessTreeProps) {
  const { labels, scopeRoots } = controller;

  return (
    <aside className="drive-access-tree" aria-label={labels.accessScopesTitle}>
      <h3 className="drive-access-tree__title">{labels.accessScopesTitle}</h3>
      <div className="drive-access-tree__list">
        {scopeRoots.map((rootPath) => (
          <TreeBranch
            key={rootPath}
            controller={controller}
            uiPath={rootPath}
            label={
              rootPath === "My Drive"
                ? labels.sidebarMyDrive
                : (rootPath.split("/").pop() ?? rootPath)
            }
            depth={0}
            isRoot
          />
        ))}
      </div>
    </aside>
  );
}
