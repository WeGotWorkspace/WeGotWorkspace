import { resolveDriveViewIcon } from "@/drive-core/src/drive-view-icon-utils";
import type { ViewKey } from "@/lib/files/drive-models";

export function DriveViewIcon({
  view,
  className = "size-3.5",
}: {
  view: ViewKey;
  className?: string;
}) {
  const Icon = resolveDriveViewIcon(view);
  return <Icon className={className} aria-hidden />;
}
