import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";

export const fullDriveMyRights: WgwDriveDirectoryEntry["myRights"] = {
  mayView: true,
  mayComment: true,
  mayReview: true,
  mayEditContent: true,
  mayManageStructure: true,
  mayShare: true,
};
