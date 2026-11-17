import { useMemo, useState } from "react";
import {
  Check,
  Download,
  Eraser,
  Loader2,
  Package,
  RefreshCw,
  ScrollText,
  Terminal,
} from "lucide-react";
import { Button } from "@/button/src/button";
import { Callout } from "@/callout/src/callout";
import { WorkspacePageSection } from "@/workspace-shell/src/workspace-page";
import { FieldLabelRow } from "@/ui/field-label-row";
import { useTrackAutosave } from "@/ui/autosave-status";
import { CollectionGhostSelectTrigger } from "@/ui/collection-ghost-select";
import { IconActionButton } from "@/admin-core/src/admin-workspace-widgets";
import { DataTable, type DataTableColumn } from "@/data-table/src/data-table";
import { Tag } from "@/tag/src/tag";
import { Select, SelectContent, SelectItem, SelectValue } from "@/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { buttonVariants } from "@/button/src/button";
import {
  formatByteCount,
  formatHumanDateTime,
  parseUpdateLogLine,
  UPDATE_PROGRESS_STEPS,
  type UpdateLogRow,
} from "@/admin-core/src/admin-workspace-utils";
import type { AdminUpdateChannel } from "@/lib/models/admin-types";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";

const DOCKER_INSTALL_DOCS_URL =
  "https://github.com/WeGotWorkspace/wegotworkspace/blob/main/docs/install-docker.md";

const UPDATE_CHANNEL_OPTIONS: { value: AdminUpdateChannel; label: string }[] = [
  { value: "stable", label: "Stable" },
  { value: "beta", label: "Beta" },
  { value: "edge", label: "Edge" },
];

type UpdateChannelNote = { message: string };

// Below 1.0 there is no production-ready release yet: stable is the most
// tested build, not a compatibility promise.
const PRE_1_0_STABLE_NOTE: UpdateChannelNote = {
  message:
    "Stable is the most tested build, but WeGotWorkspace has not reached 1.0 yet. Releases can still change behaviour. Keep a backup before you update.",
};

function isPre1_0(version: string | null | undefined): boolean {
  return /^v?0\./.test(version ?? "");
}

const UPDATE_CHANNEL_NOTES: Record<AdminUpdateChannel, UpdateChannelNote | null> = {
  stable: null,
  beta: {
    message:
      "Offers prereleases and stable releases, whichever is newer. Switching back to stable does not downgrade: this install stays on its version until stable catches up.",
  },
  edge: {
    message:
      "Every merge to main ships here. Database changes only move forward, so this install cannot go back to beta or stable. Use edge for testing only.",
  },
};

export type AdminUpdatesPaneProps = {
  controller: AdminControllerState;
  setConfirmClearLogsOpen: (open: boolean) => void;
  setConfirmUpdateOpen: (open: boolean) => void;
  updatingNow: boolean;
};

export function AdminUpdatesPane({
  controller,
  setConfirmClearLogsOpen,
  setConfirmUpdateOpen,
  updatingNow,
}: AdminUpdatesPaneProps) {
  const isDockerChannel = controller.updates.installChannel === "docker";
  const updateChannel = controller.updates.updateChannel;
  const updateChannelNote =
    updateChannel === "stable" && isPre1_0(controller.updates.installedVersion)
      ? PRE_1_0_STABLE_NOTE
      : UPDATE_CHANNEL_NOTES[updateChannel];
  const [confirmEdgeOpen, setConfirmEdgeOpen] = useState(false);
  const trackSave = useTrackAutosave();
  // Edge cannot be undone once an edge build is installed, so it is never one click.
  const chooseUpdateChannel = (channel: AdminUpdateChannel) => {
    if (channel === "edge" && updateChannel !== "edge") {
      setConfirmEdgeOpen(true);
      return;
    }
    trackSave(() => controller.actions.setUpdateChannel(channel)).catch(() => {});
  };
  const updateLogRows = useMemo(
    () =>
      controller.updateLogLines.map((line, index) => parseUpdateLogLine(line, index)).slice(-25),
    [controller.updateLogLines],
  );

  const activeProgressStep = UPDATE_PROGRESS_STEPS.findIndex((step) =>
    step.phases.includes(controller.updates.phase ?? ""),
  );
  const completedProgressSteps =
    activeProgressStep < 0
      ? 0
      : Math.min(UPDATE_PROGRESS_STEPS.length, Math.max(activeProgressStep + 1, 1));
  const displayProgressCount =
    controller.updates.phase === "downloading" && controller.updates.download
      ? controller.updates.download.totalBytes && controller.updates.download.totalBytes > 0
        ? `${formatByteCount(controller.updates.download.downloadedBytes)} / ${formatByteCount(controller.updates.download.totalBytes)}`
        : `${formatByteCount(controller.updates.download.downloadedBytes)} downloaded`
      : controller.updates.phaseProgress
        ? `${Math.min(controller.updates.phaseProgress.completed, controller.updates.phaseProgress.total)} / ${controller.updates.phaseProgress.total}`
        : `${Math.max(0, completedProgressSteps)} / ${UPDATE_PROGRESS_STEPS.length}`;
  const progressPercent =
    controller.updates.phase === "downloading" && controller.updates.download
      ? controller.updates.download.percent !== null &&
        controller.updates.download.percent !== undefined
        ? Math.max(2, Math.min(100, controller.updates.download.percent))
        : 6
      : controller.updates.phaseProgress?.percent
        ? Math.max(2, Math.min(100, controller.updates.phaseProgress.percent))
        : activeProgressStep >= 0
          ? Math.max(
              2,
              Math.min(95, ((activeProgressStep + 1) / UPDATE_PROGRESS_STEPS.length) * 100),
            )
          : 2;

  const progressCard = (
    <div className="admin-updates-progress-card">
      <div className="admin-updates-progress-head">
        <div className="admin-updates-stat-label--strong">Update progress</div>
        <div className="admin-updates-progress-count">{displayProgressCount}</div>
      </div>
      <div className="admin-updates-progress-track">
        <div className="admin-updates-progress-fill" style={{ width: `${progressPercent}%` }} />
      </div>
      <ol className="admin-updates-step-list">
        {UPDATE_PROGRESS_STEPS.map((step, index) => {
          const isDone = activeProgressStep > index;
          const isActive = activeProgressStep === index;
          const stepState = isDone ? "done" : isActive ? "active" : "pending";
          return (
            <li key={step.label} className="admin-updates-step-row">
              <span className="admin-updates-step-dot" data-step-state={stepState}>
                {isDone ? (
                  <Check className="size-3" />
                ) : isActive ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <span className="size-1.5 rounded-full bg-current" />
                )}
              </span>
              <span className="admin-updates-step-label">{step.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );

  const logColumns: DataTableColumn<UpdateLogRow>[] = useMemo(
    () => [
      {
        key: "time",
        header: "Date",
        muted: true,
        shrink: true,
        render: (row) => formatHumanDateTime(row.date),
      },
      {
        key: "level",
        header: "Level",
        muted: true,
        shrink: true,
        render: (row) => row.level,
      },
      {
        key: "message",
        header: "Message",
        cellClassName: "whitespace-normal",
        render: (row) => row.message,
      },
    ],
    [],
  );

  const updates = controller.updates;
  const latestVersion = updates.latest?.version ?? updates.installedVersion ?? "-";
  const checkButton = (
    <Button
      variant="outline"
      size="sm"
      onClick={controller.actions.checkUpdates}
      disabled={controller.checkingUpdates || updates.inProgress}
    >
      {controller.checkingUpdates ? (
        <Loader2 className="size-4 mr-2 animate-spin" />
      ) : (
        <RefreshCw className="size-4 mr-2" />
      )}
      {controller.checkingUpdates ? "Checking..." : "Check now"}
    </Button>
  );

  return (
    <>
      {updates.lastCheckError ? (
        <Callout
          className="admin-pane-callout"
          severity="error"
          title="Could not check for updates"
          message={updates.lastCheckError}
        />
      ) : null}

      <WorkspacePageSection title="Version" icon={<Package aria-hidden />}>
        <FieldLabelRow layout="inline" label="Installed">
          <Tag label={updates.installedVersion || "-"} />
        </FieldLabelRow>
        {isDockerChannel ? (
          <>
            <FieldLabelRow layout="inline" label="Update channel" description="Set on the host.">
              <Tag label={updateChannel} />
            </FieldLabelRow>
            {updates.imageTag ? (
              <FieldLabelRow layout="inline" label="Image tag">
                <Tag label={updates.imageTag} />
              </FieldLabelRow>
            ) : null}
          </>
        ) : (
          <>
            <FieldLabelRow
              layout="inline"
              label="Latest"
              description={
                updates.lastCheckedAt
                  ? `Checked ${formatHumanDateTime(updates.lastCheckedAt)}.`
                  : "Not checked yet."
              }
              below={updates.inProgress ? progressCard : undefined}
            >
              <span className="admin-row-actions">
                {updates.updateAvailable ? (
                  <Button
                    size="sm"
                    onClick={() => setConfirmUpdateOpen(true)}
                    disabled={!updates.compatible || updatingNow || updates.inProgress}
                  >
                    <Download className="size-4 mr-2" />
                    {`Update to ${latestVersion}`}
                  </Button>
                ) : (
                  <Tag label={latestVersion} />
                )}
                {checkButton}
              </span>
            </FieldLabelRow>
            <FieldLabelRow
              layout="inline"
              label="Update channel"
              description={updateChannelNote?.message ?? "The most tested releases."}
              htmlFor="admin-update-channel"
            >
              <Select
                value={updateChannel}
                onValueChange={(value) => chooseUpdateChannel(value as AdminUpdateChannel)}
                disabled={controller.savingUpdateChannel || updates.inProgress}
              >
                <CollectionGhostSelectTrigger id="admin-update-channel" label={<SelectValue />} />
                <SelectContent align="end">
                  {UPDATE_CHANNEL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldLabelRow>
          </>
        )}
      </WorkspacePageSection>

      {isDockerChannel ? (
        <WorkspacePageSection title="Upgrade on the host" icon={<Terminal aria-hidden />}>
          <p className="workspace-page-section__lead">
            This server runs from a container image, so it updates on the host, not here. Run:
          </p>
          <pre className="admin-updates-docker-commands">
            <code>{`cd wegotworkspace\nbash setup.sh check\nbash setup.sh upgrade`}</code>
          </pre>
          <p className="workspace-page-section__lead">
            To switch channel, pass it once:{" "}
            <code className="admin-updates-inline-code">bash setup.sh upgrade --channel beta</code>{" "}
            (stable, beta or edge). Backups, rollback and troubleshooting:{" "}
            <a
              className="admin-updates-docs-link"
              href={DOCKER_INSTALL_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              install-docker.md
            </a>
            .
          </p>
        </WorkspacePageSection>
      ) : null}

      <WorkspacePageSection
        title="Log"
        icon={<ScrollText aria-hidden />}
        action={
          <span className="admin-row-actions admin-row-actions--tight">
            <IconActionButton
              label="Download full log"
              onClick={controller.actions.downloadUpdateLog}
            >
              <Download className="size-4" />
            </IconActionButton>
            <IconActionButton label="Refresh logs" onClick={controller.actions.refreshUpdateLog}>
              <RefreshCw className="size-4" />
            </IconActionButton>
            <IconActionButton label="Clear logs" onClick={() => setConfirmClearLogsOpen(true)}>
              <Eraser className="size-4" />
            </IconActionButton>
          </span>
        }
      >
        {updateLogRows.length > 0 ? (
          <DataTable data={updateLogRows} columns={logColumns} rowKey={(row) => row.id} />
        ) : (
          <p className="workspace-page-section__lead">Nothing logged yet.</p>
        )}
      </WorkspacePageSection>

      <AlertDialog open={confirmEdgeOpen} onOpenChange={setConfirmEdgeOpen}>
        <AlertDialogContent className="admin-dialog-surface">
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to the edge channel?</AlertDialogTitle>
            <AlertDialogDescription>
              Edge offers a build of every merge to main. Once this install updates to an edge
              build, it cannot go back to beta or stable: database changes only move forward. Use
              edge only on a test install, never with production data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                setConfirmEdgeOpen(false);
                trackSave(() => controller.actions.setUpdateChannel("edge")).catch(() => {});
              }}
            >
              Switch to edge
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
