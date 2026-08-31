import type { DragEvent, ReactNode } from "react";
import "./collection-layout.css";

type CollectionPaneProps = {
  children: ReactNode;
};

export function CollectionListPane({ children }: CollectionPaneProps) {
  return <section className="collection-list-pane">{children}</section>;
}

type CollectionHeaderProps = {
  children: ReactNode;
};

export function CollectionHeader({ children }: CollectionHeaderProps) {
  return <header className="collection-header p-4 md:p-6 border-b">{children}</header>;
}

type CollectionListWorkspaceProps = {
  header: ReactNode;
  listContent: ReactNode;
  hasItems: boolean;
  emptyLabel: string;
  floatingActionBar?: React.ReactNode;
  dropZone?: {
    active: boolean;
    overlay: ReactNode;
    onDragOver: (event: DragEvent) => void;
    onDragLeave: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
  };
};

export function CollectionListWorkspace({
  header,
  listContent,
  hasItems,
  emptyLabel,
  floatingActionBar,
  dropZone,
}: CollectionListWorkspaceProps) {
  const listBody = (
    <>
      <div
        className={`flex-1 notes-swipe-list ${hasItems ? "overflow-y-auto" : "overflow-y-hidden"}`}
      >
        {hasItems ? (
          listContent
        ) : (
          <div className="collection-empty-state p-10 text-center text-sm">{emptyLabel}</div>
        )}
      </div>
      {floatingActionBar}
    </>
  );

  return (
    <CollectionListPane>
      <CollectionHeader>{header}</CollectionHeader>

      {dropZone ? (
        <div
          className="collection-list-drop-zone relative flex min-h-0 flex-1 flex-col"
          onDragOver={dropZone.onDragOver}
          onDragLeave={dropZone.onDragLeave}
          onDrop={dropZone.onDrop}
        >
          {dropZone.active ? dropZone.overlay : null}
          {listBody}
        </div>
      ) : (
        listBody
      )}
    </CollectionListPane>
  );
}
