import { CircleAlert, CircleCheck, CircleDashed } from "lucide-react";
import type { InstallerCheckStatus } from "@/installer-core/src/installer-types";

export function InstallerStatusDot({ status }: { status: InstallerCheckStatus }) {
  const map: Record<InstallerCheckStatus, { color: string; Icon: typeof CircleCheck }> = {
    ok: { color: "var(--installer-status-ok)", Icon: CircleCheck },
    warn: { color: "var(--installer-status-warn)", Icon: CircleAlert },
    error: { color: "var(--installer-status-error)", Icon: CircleAlert },
    pending: { color: "var(--installer-status-pending)", Icon: CircleDashed },
  };
  const { color, Icon } = map[status];
  return <Icon className="size-4 shrink-0" style={{ color }} aria-hidden />;
}
