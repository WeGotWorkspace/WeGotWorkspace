import { useState } from "react";
import { ArrowUpRight, RefreshCw, ShieldCheck, Stethoscope } from "lucide-react";
import { Button } from "@/button/src/button";
import { Tag, type TagTone } from "@/tag/src/tag";
import { FieldLabelRow } from "@/ui/field-label-row";
import { WorkspacePageSection } from "@/workspace-shell/src/workspace-page";
import { IconActionButton } from "@/admin-core/src/admin-workspace-widgets";
import {
  appUrlFromBrowserLocation,
  getServerCheckVisual,
  isLoopbackOrigin,
} from "@/admin-core/src/admin-workspace-utils";
import type { AdminSecurityWarning } from "@/lib/models/admin-types";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";

const DOCS = "https://github.com/WeGotWorkspace/wegotworkspace/blob/main";
const HTTPS_DOCS_URL = `${DOCS}/docs/getting-started.md#requirement-https`;
const WEB_ROOT_DOCS_URL = `${DOCS}/INSTALL.md#move-an-existing-data-directory-out-of-the-web-root`;

/** Only the data directory holds the database and keys; other folders hold code. */
function reachableMessage(directories: readonly string[]): string {
  const list = directories.join(", ");
  const verb = directories.length === 1 ? "is" : "are";
  return directories.includes("wgw-content")
    ? `${list} ${verb} reachable from the web. The data directory, including the database and private keys, can be downloaded.`
    : `${list} ${verb} reachable from the web.`;
}

export type SecuritySeverity = "critical" | "warning" | "notice" | "ok";

const SEVERITY_TAG: Record<SecuritySeverity, { label: string; tone?: TagTone }> = {
  critical: { label: "Critical", tone: "danger" },
  warning: { label: "Warning", tone: "warning" },
  notice: { label: "Notice" },
  ok: { label: "OK", tone: "success" },
};

const SEVERITY_ORDER: SecuritySeverity[] = ["critical", "warning", "notice", "ok"];

export type SecurityCheck = {
  id: string;
  title: string;
  description: string;
  severity: SecuritySeverity;
  /** A page that explains the fix. */
  fixUrl?: string;
  /** The browser's address, offered as the site address ("Use this address"). */
  useAddress?: string;
};

/**
 * Every security check of this install as one row each, problems first (Critical,
 * Warning, Notice), then the checks that pass. Server warnings come by `code`; HTTPS and
 * reachable folders are measured in the browser.
 */
export function adminSecurityChecks({
  warnings,
  secureContext,
  reachableDirectories,
  baseUri,
  origin = globalThis.location?.origin ?? "",
}: {
  warnings: readonly AdminSecurityWarning[];
  secureContext: boolean;
  reachableDirectories: readonly string[];
  baseUri: string;
  /** Browser origin; a parameter so tests can pass a public one. */
  origin?: string;
}): SecurityCheck[] {
  const byCode = new Map<string, AdminSecurityWarning>(
    warnings.map((warning) => [warning.code, warning]),
  );
  const known = new Set<string>();
  const take = (code: string) => {
    known.add(code);
    return byCode.get(code);
  };

  const checks: SecurityCheck[] = [];

  checks.push(
    secureContext
      ? {
          id: "https",
          title: "HTTPS",
          // http://localhost is a secure context too, but it is not https.
          description: origin.startsWith("http:")
            ? "This site opens on this computer, which the browser treats as secure. Use https:// on the public address."
            : "This site opens over https://.",
          severity: "ok",
        }
      : {
          id: "https",
          title: "HTTPS",
          description:
            "This site opens over http://, so live editing, notifications, offline use and large uploads are off.",
          severity: "critical",
          fixUrl: HTTPS_DOCS_URL,
        },
  );

  const dataDirPublished = take("data_dir_published");
  checks.push(
    dataDirPublished || reachableDirectories.length > 0
      ? {
          id: "web-root",
          title: "Web root isolation",
          description:
            reachableDirectories.length > 0
              ? reachableMessage(reachableDirectories)
              : "The data directory is inside the public web root; database files could be exposed.",
          severity: "critical",
          fixUrl: WEB_ROOT_DOCS_URL,
        }
      : {
          id: "web-root",
          title: "Web root isolation",
          description: "The data directory is outside the public web root.",
          severity: "ok",
        },
  );

  checks.push(
    take("app_debug_on")
      ? {
          id: "debug",
          title: "Debug mode",
          description: "APP_DEBUG is on, so error pages can show internal details.",
          severity: "warning",
        }
      : { id: "debug", title: "Debug mode", description: "APP_DEBUG is off.", severity: "ok" },
  );

  const env = take("app_env_not_production");
  checks.push(
    env
      ? {
          id: "env",
          title: "Environment mode",
          description: env.message.replace(/, not production\.$/, " rather than production."),
          severity: "warning",
        }
      : {
          id: "env",
          title: "Environment mode",
          description: "APP_ENV is production.",
          severity: "ok",
        },
  );

  const appUrlLocal = take("app_url_local");
  const appUrlUnset = take("app_url_unset");
  // The server ignores a loopback APP_URL, so offering one would change nothing.
  const local = origin !== "" && isLoopbackOrigin(origin);
  const useAddress =
    !local && origin !== "" ? appUrlFromBrowserLocation(origin, baseUri) : undefined;
  if (appUrlLocal || appUrlUnset) {
    checks.push({
      id: "app-url",
      title: "Public host address",
      description: appUrlLocal
        ? local
          ? "APP_URL is a local address, so password reset emails stay paused. Open Admin on the public address, or set APP_URL in packages/api/.env (Docker: api.env on the config volume)."
          : "APP_URL is a local address. Password reset emails stay paused."
        : "APP_URL is not set, so password reset emails are off. Set it here, or in packages/api/.env (Docker: api.env on the config volume).",
      // Working on a local machine, the admin cannot fix it from here: inform, do not alarm.
      severity: local ? "notice" : "warning",
      useAddress,
    });
  } else {
    checks.push({
      id: "app-url",
      title: "Public host address",
      description: "APP_URL is the site's public address.",
      severity: "ok",
    });
  }

  // A warning this page does not know yet still shows, in the server's words.
  for (const warning of warnings) {
    if (known.has(warning.code)) continue;
    checks.push({
      id: warning.code,
      title: "Security warning",
      description: warning.message,
      severity: "warning",
    });
  }

  return checks.sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
}

/** Checks that need the admin (Critical, Warning): the sidebar badge on Health. */
export function adminHealthIssueCount(checks: readonly SecurityCheck[]): number {
  return checks.filter((check) => check.severity === "critical" || check.severity === "warning")
    .length;
}

export function AdminSecurityChecks({
  checks,
  onUseThisAddress,
}: {
  checks: readonly SecurityCheck[];
  onUseThisAddress?: (url: string) => Promise<boolean | void> | boolean | void;
}) {
  const [pending, setPending] = useState(false);
  return (
    <>
      {checks.map((check) => {
        const tag = SEVERITY_TAG[check.severity];
        return (
          <FieldLabelRow
            key={check.id}
            layout="inline"
            label={check.title}
            description={check.description}
          >
            <span className="admin-row-actions">
              {check.useAddress && onUseThisAddress ? (
                <Button
                  label="Use this address"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    const url = check.useAddress;
                    if (!url) return;
                    setPending(true);
                    void Promise.resolve(onUseThisAddress(url)).finally(() => setPending(false));
                  }}
                />
              ) : null}
              {check.fixUrl ? (
                <a
                  className="admin-fix-link"
                  href={check.fixUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Fix
                  <ArrowUpRight aria-hidden />
                </a>
              ) : null}
              <Tag label={tag.label} tone={tag.tone} dot />
            </span>
          </FieldLabelRow>
        );
      })}
    </>
  );
}

const CHECK_TAG: Record<"success" | "warning" | "error", { label: string; tone: TagTone }> = {
  success: { label: "OK", tone: "success" },
  warning: { label: "Warning", tone: "warning" },
  error: { label: "Failed", tone: "danger" },
};

export type AdminHealthPaneProps = {
  controller: AdminControllerState;
  securityChecks: readonly SecurityCheck[];
};

export function AdminHealthPane({ controller, securityChecks }: AdminHealthPaneProps) {
  return (
    <>
      <WorkspacePageSection title="Security" icon={<ShieldCheck aria-hidden />}>
        <AdminSecurityChecks
          checks={securityChecks}
          onUseThisAddress={(url) => controller.actions.useThisAddress(url)}
        />
      </WorkspacePageSection>

      <WorkspacePageSection
        title="Server checks"
        icon={<Stethoscope aria-hidden />}
        action={
          <IconActionButton
            label="Refresh checks"
            onClick={controller.actions.refreshServerChecks}
            disabled={controller.refreshingServerChecks}
          >
            <RefreshCw className="size-4" />
          </IconActionButton>
        }
      >
        {controller.updates.checks.map((check, index) => {
          const { tone } = getServerCheckVisual(check);
          const tag = CHECK_TAG[tone];
          return (
            <FieldLabelRow
              key={`${check.label}-${index}`}
              layout="inline"
              label={check.label}
              description={check.detail}
            >
              <Tag label={tag.label} tone={tag.tone} dot />
            </FieldLabelRow>
          );
        })}
      </WorkspacePageSection>
    </>
  );
}
