import type { WgwInstallerRuntimeState } from "@/installer-core/src/installer-types";
import type { InstallerServerCheck } from "@/installer-core/src/installer-types";

export function toInstallerServerChecks(
  state: WgwInstallerRuntimeState | null,
): InstallerServerCheck[] {
  const rows = state?.checks ?? [];
  return rows.map((row, index) => {
    const optional =
      Boolean((row as { optional?: boolean }).optional) || /\(optional\)/i.test(row.label);
    return {
      id: String(index),
      label: row.label,
      status: row.ok ? "ok" : optional ? "warn" : "error",
      detail: row.detail,
    };
  });
}
