import type { WgwInstallerRuntimeState } from "@/install-core/src/install-types";
import type { InstallServerCheck } from "@/install-core/src/install-types";

export function toInstallServerChecks(
  state: WgwInstallerRuntimeState | null,
): InstallServerCheck[] {
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

export function installBlockingChecks(checks: InstallServerCheck[]): InstallServerCheck[] {
  return checks.filter((check) => check.status === "error");
}
