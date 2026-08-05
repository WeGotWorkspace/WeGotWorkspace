import { Badge } from "@/ui/badge";
import type { DriveShareAccess } from "@wgw-api-generated/drive-types";
import { driveAccessLabel } from "@/drive-core/src/drive-access-utils";

export function DriveAccessPermPill({ access }: { access: DriveShareAccess }) {
  return (
    <Badge variant="outline" className="drive-access-perm-pill">
      {driveAccessLabel(access)}
    </Badge>
  );
}
