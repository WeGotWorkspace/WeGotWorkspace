import type { ReactNode } from "react";
import {
  Cloud,
  Database,
  Mail as MailIcon,
  PartyPopper,
  Phone,
  ServerCog,
  Sparkles,
  UserPlus,
} from "lucide-react";
import type { WgwInstallerRuntimeState } from "@/install-core/src/install-types";
import type {
  InstallServerCheck,
  InstallStepId,
  InstallerBackendStep,
} from "@/install-core/src/install-types";

export const INSTALL_STEPS: { id: InstallStepId; label: string; icon: ReactNode }[] = [
  { id: "welcome", label: "Welcome", icon: <Sparkles className="size-3.5" /> },
  { id: "server", label: "Server check", icon: <ServerCog className="size-3.5" /> },
  { id: "database", label: "Database", icon: <Database className="size-3.5" /> },
  { id: "dav", label: "Files, Contacts & Calendars", icon: <Cloud className="size-3.5" /> },
  { id: "mail", label: "Mail server", icon: <MailIcon className="size-3.5" /> },
  { id: "meet", label: "Meet", icon: <Phone className="size-3.5" /> },
  { id: "admin", label: "Admin account", icon: <UserPlus className="size-3.5" /> },
  { id: "done", label: "Done", icon: <PartyPopper className="size-3.5" /> },
];

export function installBackendStepToUiStep(step: InstallerBackendStep): InstallStepId {
  switch (step) {
    case "requirements":
      return "server";
    case "database":
      return "database";
    case "site":
      return "dav";
    case "account":
      return "admin";
    case "done":
    case "installed":
      return "done";
    default:
      return "welcome";
  }
}

export function installStepIndex(step: InstallStepId): number {
  return Math.max(
    0,
    INSTALL_STEPS.findIndex((candidate) => candidate.id === step),
  );
}

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
