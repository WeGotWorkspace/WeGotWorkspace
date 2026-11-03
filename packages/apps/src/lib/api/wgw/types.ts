/**
 * Concrete shapes for WeGotWorkspace `/api/v1` notes, settings and admin payloads.
 * Built on top of generated OpenAPI aliases with app-specific narrowing where needed.
 */

import type {
  SettingsStateResponse,
  SettingsUserGroup,
  SettingsUserProfile,
} from "@wgw/openapi-types/settings-types";
import type {
  AdminAppsSettings,
  AdminGroupCreateRequest,
  AdminGroupSummary,
  AdminGroupUpdateRequest,
  AdminMailSettings,
  AdminSettingsSaveRequest,
  AdminSecurityWarning,
  AdminStateResponse,
  AdminUserCreateRequest,
  AdminUserSummary,
  AdminUserUpdateRequest,
  AdminRtcSettings,
  AdminWebdavSettings,
  UpdateApplyRequest,
  UpdateApplyResponse,
  UpdateBackupItem,
  UpdateLogResponse,
  UpdateStateResponse,
} from "@wgw/openapi-types/admin-types";
import type {
  DriveChangeDirRequest,
  DriveCreateRequest,
  DriveCwdResponse,
  DriveDeleteItem,
  DriveDeleteItemsRequest,
  DriveDirectoryData,
  DriveDirectoryEntry,
  DriveEntryType,
  DriveGetDirRequest,
  DriveListingResponse,
  DriveMutationResponse,
  DriveMutationResult,
  DriveRenameRequest,
  DriveRootPath,
  DriveSearchRequest,
  DriveUserData,
  DriveUserResponse,
} from "@wgw/openapi-types/drive-types";
import type {
  MeetChatRequest,
  MeetChatResponse,
  MeetJoinRequest,
  MeetJoinResponse,
  MeetLeaveRequest,
  MeetLeaveResponse,
  MeetPeer,
  MeetPollRequest,
  MeetPollResponse,
  MeetSendRequest,
  MeetSendResponse,
  MeetSignalEnvelope,
} from "@wgw/openapi-types/meet-types";
import type {
  InstallerAction,
  InstallerActionPayload,
  InstallerActionRequest,
  InstallerActionResponse,
  InstallerBootstrapResponse,
  InstallerCheck,
  InstallerDbDriver,
  InstallerDbState,
  InstallerErrorCode,
  InstallerRuntimeState,
  InstallerStep,
} from "@wgw/openapi-types/installer-types";

/** Local note row after the `/notes/*` REST sunset (FileNode projection + collab). */
export type WgwNoteItem = {
  id: string;
  notebook: string;
  username?: string;
  body?: string;
  tags?: string[];
  starred?: boolean;
  archived?: boolean;
  updatedAt?: string;
  /** File mtime; advances on body collab saves. Optional on older payloads. */
  contentUpdatedAt?: string;
  scope?: "personal" | "group";
  groupSlug?: string | null;
  /** Outgoing share indicators from list annotation (optional). */
  hasShares?: boolean;
  hasPublicShare?: boolean;
  hasTeamShare?: boolean;
};

export type WgwNoteUpsertRequest = {
  id?: string;
  /** Omitted when this PATCH must not move the note. Create still sends it. */
  notebook?: string;
  /** REST collection id — preferred over name when looking up the dest notebook. */
  notebookId?: string;
  title?: string | null;
  body?: string;
  tags?: string[];
  /** Sent as `categoriesAdd`. Omit `tags` when this is set. */
  tagsAdd?: string[];
  /** Sent as `categoriesRemove`. Omit `tags` when this is set. */
  tagsRemove?: string[];
  starred?: boolean;
  archived?: boolean;
  groupSlug?: string | null;
  /** REST If-Match token (`etag`). Required on live metadata PATCH. */
  etag?: string;
};

export type WgwSettingsStateResponse = SettingsStateResponse;
export type WgwSettingsUserProfile = SettingsUserProfile;
export type WgwSettingsUserGroup = SettingsUserGroup;

export type WgwAdminStateResponse = AdminStateResponse;
export type WgwAdminSecurityWarning = AdminSecurityWarning;
export type WgwAdminUserSummary = AdminUserSummary;
export type WgwAdminGroupSummary = AdminGroupSummary;
export type WgwAdminMailSettings = AdminMailSettings;
export type WgwAdminRtcSettings = AdminRtcSettings;
export type WgwAdminAppsSettings = AdminAppsSettings;
export type WgwAdminWebdavSettings = AdminWebdavSettings;
export type WgwAdminSettingsSaveRequest = AdminSettingsSaveRequest;
export type WgwAdminUserCreateRequest = AdminUserCreateRequest;
export type WgwAdminUserUpdateRequest = AdminUserUpdateRequest;
export type WgwAdminGroupCreateRequest = AdminGroupCreateRequest;
export type WgwAdminGroupUpdateRequest = AdminGroupUpdateRequest;
export type WgwUpdateStateResponse = UpdateStateResponse;
export type WgwUpdateApplyRequest = UpdateApplyRequest;
export type WgwUpdateApplyResponse = UpdateApplyResponse;
export type WgwUpdateLogResponse = UpdateLogResponse;
export type WgwUpdateBackupItem = UpdateBackupItem;
export type WgwSearchReindexStateResponse = {
  inProgress: boolean;
  phase: string | null;
  phaseProgress: {
    completed: number;
    total: number;
    percent: number;
    updatedAt: string;
  } | null;
  cancelRequested: boolean;
  lastResult: {
    ok: boolean;
    message: string;
    finishedAt: string | null;
  } | null;
  logLines: string[];
};
export type WgwDriveEntryType = DriveEntryType;
export type WgwDriveRootPath = DriveRootPath;
/**
 * Why a queued upload failed (#1520). `too_large`: refused even at the
 * smallest part size. `quota`: the device refused to store the file.
 * `server_full`: 507 or `overQuota`; pauses the whole queue. `auth`: a 401
 * (sign in again). `forbidden`: a 403, e.g. write access to the folder is
 * gone; never retried, no sign-in. `target_missing`: the target folder was
 * deleted or trashed. `no_local_copy`: a direct upload whose bytes are gone
 * after a reload. `insecure_context`: a large file on an `http://` install
 * (#1519). `transient`: server or network hiccups that kept coming back after
 * the retries with backoff. `permanent`: anything else retrying will not fix.
 */
export type WgwDriveUploadErrorCode =
  | "too_large"
  | "quota"
  | "server_full"
  | "auth"
  | "forbidden"
  | "target_missing"
  | "no_local_copy"
  | "insecure_context"
  | "transient"
  | "permanent";
/** UI-only marker on a cached placeholder row for a file still in the upload queue. */
export type WgwDriveUploadPlaceholder = {
  /** Upload queue item id. */
  id: string;
  batchId: string;
  status: "queued" | "uploading" | "failed";
  /** Set while `status` is `failed`. */
  reason?: WgwDriveUploadErrorCode;
};
/**
 * Signed-in listings add `nodeId` from JMAP. The guest REST listing leaves it
 * unset: guests have no offline cache, so the id is not backfilled there.
 */
export type WgwDriveDirectoryEntry = DriveDirectoryEntry & {
  nodeId?: string;
  /**
   * The file's version as the listing saw it (signed-in JMAP listings only).
   * A *Replace* sends it back as `expectedBlobId`.
   */
  blobId?: string;
  /** The server is still hashing a file that arrived outside WGW: no *Replace*. */
  contentHashPending?: boolean;
  upload?: WgwDriveUploadPlaceholder;
};
/** Listing rows may carry the UI-only FileNode id. The OpenAPI schema does not. */
export type WgwDriveDirectoryData = Omit<DriveDirectoryData, "files"> & {
  files: WgwDriveDirectoryEntry[];
};
export type WgwDriveGetDirRequest = DriveGetDirRequest;
export type WgwDriveSearchRequest = DriveSearchRequest;
export type WgwDriveChangeDirRequest = DriveChangeDirRequest;
export type WgwDriveCreateRequest = DriveCreateRequest;
export type WgwDriveRenameRequest = DriveRenameRequest;
export type WgwDriveDeleteItem = DriveDeleteItem;
export type WgwDriveDeleteItemsRequest = DriveDeleteItemsRequest;
export type WgwDriveUserData = DriveUserData;
export type WgwDriveUserResponse = DriveUserResponse;
export type WgwDriveListingResponse = DriveListingResponse;
export type WgwDriveCwdResponse = DriveCwdResponse;
export type WgwDriveMutationResult = DriveMutationResult;
export type WgwDriveMutationResponse = DriveMutationResponse;
export type WgwDriveStarsData = {
  paths: string[];
};
export type WgwDriveStarsResponse = {
  data: WgwDriveStarsData;
};
export type WgwDriveStarUpdateRequest = {
  path: string;
  starred: boolean;
};
export type WgwMeetPeer = MeetPeer;
export type WgwMeetSignalEnvelope = MeetSignalEnvelope;
export type WgwMeetRoomStatusRequest = {
  room: string;
};
export type WgwMeetRoomStatusResponse = {
  reserved: boolean;
  active: boolean;
  ownerPrincipal?: string;
  createdBy?: string;
  expiresAt?: string | null;
};
export type WgwMeetReserveRoomRequest = {
  room: string;
  ownerPrincipal: string;
  expiresAt?: string | null;
};
export type WgwMeetPatchRoomRequest = {
  room: string;
  expiresAt: string | null;
};
export type WgwMeetJoinRequest = MeetJoinRequest;
export type WgwMeetJoinResponse = MeetJoinResponse;
export type WgwMeetPollRequest = MeetPollRequest;
export type WgwMeetPollResponse = MeetPollResponse;
export type WgwMeetSendRequest = MeetSendRequest;
export type WgwMeetSendResponse = MeetSendResponse;
export type WgwMeetLeaveRequest = MeetLeaveRequest;
export type WgwMeetLeaveResponse = MeetLeaveResponse;
export type WgwMeetChatRequest = MeetChatRequest;
export type WgwMeetChatResponse = MeetChatResponse;
export type WgwInstallerStep = InstallerStep;
export type WgwInstallerDbDriver = InstallerDbDriver;
export type WgwInstallerDbState = InstallerDbState;
export type WgwInstallerCheck = InstallerCheck;
export type WgwInstallerRuntimeState = InstallerRuntimeState;
export type WgwInstallerBootstrapResponse = InstallerBootstrapResponse;
export type WgwInstallerAction = InstallerAction;
export type WgwInstallerActionPayload = InstallerActionPayload;
export type WgwInstallerActionRequest = InstallerActionRequest;
export type WgwInstallerActionResponse = InstallerActionResponse;
export type WgwInstallerErrorCode = InstallerErrorCode;
