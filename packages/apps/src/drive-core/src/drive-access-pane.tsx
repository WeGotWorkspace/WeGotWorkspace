import { ViewHeader } from "@/view-header/src/view-header";
import { DriveAccessDetail } from "@/drive-core/src/drive-access-detail";
import { DriveAccessPersonDrawer } from "@/drive-core/src/drive-access-person-drawer";
import { DriveAccessTree } from "@/drive-core/src/drive-access-tree";
import { useDriveAccessController } from "@/drive-core/src/use-drive-access-controller";
import type { ViewKey } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations, DriveShareOperations } from "@/drive-core/src/drive-types";
import "@/drive-core/src/drive-access.css";

export type DriveAccessPaneProps = {
  shareOperations: DriveShareOperations;
  operations?: DriveAPIOperations;
  username: string;
  sidebarGroupPaths: string[];
  groupRootNames: Set<string>;
  view: ViewKey;
  onViewChange?: (view: ViewKey) => void;
  onOpenShare?: (apiPath: string) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
};

export function DriveAccessPane({
  shareOperations,
  operations,
  username,
  sidebarGroupPaths,
  groupRootNames,
  view,
  onViewChange,
  onOpenShare,
  sidebarOpen,
  onToggleSidebar,
}: DriveAccessPaneProps) {
  const controller = useDriveAccessController({
    shareOperations,
    operations,
    username,
    sidebarGroupPaths,
    groupRootNames,
    view,
    onViewChange,
    onOpenShare,
  });

  return (
    <div className="drive-access-layout">
      <header className="drive-access-layout__header">
        <ViewHeader
          title={controller.labels.accessTitle}
          subtitle={controller.subtitle}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={onToggleSidebar}
        />
      </header>
      <div className="drive-access-pane">
        <DriveAccessTree controller={controller} />
        <DriveAccessDetail controller={controller} />
      </div>
      <DriveAccessPersonDrawer controller={controller} />
    </div>
  );
}
