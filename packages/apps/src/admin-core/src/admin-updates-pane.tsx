import { useMemo, useState } from "react";
import { Check, Download, Eraser, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/button/src/button";
import { Callout } from "@/callout/src/callout";
import { Card } from "@/card/src/card";
import { DataTable, type DataTableColumn } from "@/data-table/src/data-table";
import { MenuItem } from "@/menu-item/src/menu-item";
import {
  SegmentedControl,
  type SegmentedControlOption,
} from "@/segmented-control/src/segmented-control";
import { Tag } from "@/tag/src/tag";
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
import { buttonVariants } from "@/ui/button";
import {
  formatByteCount,
  formatHumanDateTime,
  getServerCheckVisual,
  parseUpdateLogLine,
  UPDATE_PROGRESS_STEPS,
  type UpdateLogRow,
} from "@/admin-core/src/admin-workspace-utils";
import type { AdminUpdateChannel } from "@/admin-core/src/admin-types";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";

const DOCKER_INSTALL_DOCS_URL =
  "https://github.com/WeGotWorkspace/wegotworkspace/blob/main/docs/install-docker.md";

const UPDATE_CHANNEL_OPTIONS: SegmentedControlOption<AdminUpdateChannel>[] = [
  { value: "stable", label: "Stable" },
  { value: "beta", label: "Beta" },
  { value: "edge", label: "Edge" },
];

type UpdateChannelNote = { title: string; message: string };

// Below 1.0 there is no production-ready release yet: stable is the most
// tested build, not a compatibility promise.
const PRE_1_0_STABLE_NOTE: UpdateChannelNote = {
  title: "Stable, before 1.0",
  message:
    "Stable is the most tested build, but WeGotWorkspace has not reached 1.0 yet. Releases can still change behaviour. Keep a backup before you update.",
};

function isPre1_0(version: string | null | undefined): boolean {
  return /^v?0\./.test(version ?? "");
}

const UPDATE_CHANNEL_NOTES: Record<AdminUpdateChannel, UpdateChannelNote | null> = {
  stable: null,
  beta: {
    title: "Beta channel",
    message:
      "Offers prereleases and stable releases, whichever is newer. Switching back to stable does not downgrade: this install stays on its version until stable catches up.",
  },
  edge: {
    title: "Edge channel: not for production data",
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
  // Edge cannot be undone once an edge build is installed, so it is never one click.
  const chooseUpdateChannel = (channel: AdminUpdateChannel) => {
    if (channel === "edge" && updateChannel !== "edge") {
      setConfirmEdgeOpen(true);
      return;
    }
    void controller.actions.setUpdateChannel(channel);
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

  const logColumns: DataTableColumn<UpdateLogRow>[] = useMemo(
    () => [
      {
        key: "time",
        header: "Date",
        headerClassName: "font-medium pb-3 pr-3",
        cellClassName: "py-3 pr-3 whitespace-nowrap font-mono text-xs",
        render: (row) => formatHumanDateTime(row.date),
      },
      {
        key: "level",
        header: "Level",
        headerClassName: "font-medium pb-3 pr-3",
        cellClassName: "py-3 pr-3 whitespace-nowrap",
        render: (row) => row.level,
      },
      {
        key: "message",
        header: "Message",
        headerClassName: "font-medium pb-3",
        cellClassName: "py-3",
        render: (row) => row.message,
      },
    ],
    [],
  );

  return (
    <>
      <Card title="Release status">
        <div className="admin-updates-release-grid">
          <div>
            <div className="admin-updates-stat-label">Installed</div>
            <div className="admin-updates-stat-value">
              <Tag label={controller.updates.installedVersion || "-"} />
            </div>
          </div>
          {isDockerChannel ? (
            <>
              <div>
                <div className="admin-updates-stat-label">Install channel</div>
                <Tag label="docker" />
              </div>
              <div>
                <div className="admin-updates-stat-label">Update channel</div>
                <Tag label={updateChannel} />
              </div>
              {controller.updates.imageTag ? (
                <div>
                  <div className="admin-updates-stat-label">Image tag</div>
                  <div className="admin-updates-stat-value">
                    <Tag label={controller.updates.imageTag} />
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div>
                <div className="admin-updates-stat-label">Latest</div>
                <div className="admin-updates-stat-value">
                  <Tag
                    label={
                      controller.updates.latest?.version ??
                      controller.updates.installedVersion ??
                      "-"
                    }
                  />
                </div>
              </div>
              <div>
                <div className="admin-updates-stat-label" id="admin-update-channel-label">
                  Channel
                </div>
                <SegmentedControl
                  value={updateChannel}
                  onChange={chooseUpdateChannel}
                  options={UPDATE_CHANNEL_OPTIONS}
                  size="sm"
                  disabled={controller.savingUpdateChannel || controller.updates.inProgress}
                  aria-label="Update channel"
                />
              </div>
              <div className="flex-1 min-w-32">
                <div className="admin-updates-stat-label">Last checked</div>
                <Tag label={formatHumanDateTime(controller.updates.lastCheckedAt)} />
              </div>
            </>
          )}
        </div>
        {isDockerChannel ? (
          <Callout
            className="mt-5"
            severity="info"
            title="Docker install — upgrade on the host"
            message={
              <>
                <p>
                  This instance runs from a container image. Do not use Admin Updates — upgrade by
                  pulling a new image tag with{" "}
                  <code className="admin-updates-inline-code">setup.sh</code> on the host.
                </p>
                <pre className="admin-updates-docker-commands">
                  <code>{`cd wegotworkspace\nbash setup.sh check\nbash setup.sh upgrade`}</code>
                </pre>
                <p>
                  To switch the update channel, pass it once:{" "}
                  <code className="admin-updates-inline-code">
                    bash setup.sh upgrade --channel beta
                  </code>{" "}
                  (stable, beta, or edge).
                </p>
                <p>
                  See{" "}
                  <a
                    className="admin-updates-docs-link"
                    href={DOCKER_INSTALL_DOCS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    install-docker.md
                  </a>{" "}
                  for backup, rollback, and troubleshooting.
                </p>
              </>
            }
          />
        ) : (
          <>
            {updateChannelNote ? (
              <Callout
                className="mt-5"
                severity={updateChannel === "edge" ? "warning" : "info"}
                title={updateChannelNote.title}
                message={updateChannelNote.message}
              />
            ) : null}
            <Callout
              className="mt-5"
              severity={
                controller.updates.inProgress
                  ? "warning"
                  : controller.updates.updateAvailable
                    ? "warning"
                    : "success"
              }
              title={
                controller.updates.inProgress
                  ? "Update in progress"
                  : controller.updates.updateAvailable
                    ? "Update available"
                    : "You're up to date"
              }
              message={
                controller.updates.inProgress
                  ? `Applying ${controller.updates.current?.from ?? controller.updates.installedVersion} -> ${controller.updates.current?.to ?? controller.updates.latest?.version ?? "latest"} (${controller.updates.phase?.replace(/_/g, " ") ?? "processing"}).`
                  : controller.updates.updateAvailable
                    ? `${controller.updates.latest?.version ?? "A new release"} is available on the ${updateChannel} channel.`
                    : `Running the latest ${updateChannel} release.`
              }
            />
            {controller.updates.inProgress ? (
              <div className="admin-updates-progress-card">
                <div className="admin-updates-progress-head">
                  <div className="admin-updates-stat-label--strong">Update progress</div>
                  <div className="admin-updates-progress-count">{displayProgressCount}</div>
                </div>
                <div className="admin-updates-progress-track">
                  <div
                    className="admin-updates-progress-fill"
                    style={{ width: `${progressPercent}%` }}
                  />
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
            ) : null}
            {controller.updates.lastCheckError ? (
              <p className="mt-3 text-sm text-red-700">{controller.updates.lastCheckError}</p>
            ) : null}
            <div className="admin-updates-actions">
              <Button
                variant="outline"
                onClick={controller.actions.checkUpdates}
                disabled={controller.checkingUpdates}
              >
                {controller.checkingUpdates ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="size-4 mr-2" />
                )}
                {controller.checkingUpdates ? "Checking..." : "Check for updates"}
              </Button>
              <Button
                onClick={() => setConfirmUpdateOpen(true)}
                disabled={
                  !controller.updates.updateAvailable ||
                  !controller.updates.compatible ||
                  updatingNow
                }
              >
                <Download className="size-4 mr-2" />
                {`Update to ${controller.updates.latest?.version ?? "latest"}`}
              </Button>
            </div>
          </>
        )}
      </Card>

      <Card
        title="Server checks"
        iconActions={[
          {
            icon: <RefreshCw className="size-4" />,
            label: "Refresh checks",
            onClick: controller.actions.refreshServerChecks,
            disabled: controller.refreshingServerChecks,
          },
        ]}
      >
        <div className="space-y-1">
          {controller.updates.checks.map((check, index) =>
            (() => {
              const { Icon, tone } = getServerCheckVisual(check);
              return (
                <MenuItem
                  key={`${check.label}-${index}`}
                  className="admin-server-check-item"
                  icon={<Icon className="admin-server-check-icon" data-check-tone={tone} />}
                  label={check.label}
                  description={check.detail}
                />
              );
            })(),
          )}
        </div>
      </Card>

      <Card
        title="Update log"
        iconActions={[
          {
            icon: <Download className="size-4" />,
            label: "Download full log",
            onClick: controller.actions.downloadUpdateLog,
          },
          {
            icon: <RefreshCw className="size-4" />,
            label: "Refresh logs",
            onClick: controller.actions.refreshUpdateLog,
          },
          {
            icon: <Eraser className="size-4" />,
            label: "Clear logs",
            onClick: () => setConfirmClearLogsOpen(true),
          },
        ]}
      >
        <DataTable
          data={updateLogRows}
          columns={logColumns}
          rowKey={(row) => row.id}
          className="-mx-6 px-6"
          tableClassName="w-full text-sm"
          headerClassName="admin-table-head"
          rowClassName="admin-data-table-row"
        />
      </Card>

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
                void controller.actions.setUpdateChannel("edge");
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
