import type {
  DriveShareAtPath,
  DriveShareByPrincipal,
  DriveSharePrincipalEntry,
} from "@wgw-api-generated/drive-types";
import { fullDriveMyRights } from "@/lib/api/mock/drive-mock-my-rights";

const MEMBER_SHARE_ID = "a1111111-1111-4111-8111-111111111111";
const PUBLIC_SHARE_ID = "b2222222-2222-4222-8222-222222222222";
const GUEST_INVITE_ID = "c3333333-3333-4333-8333-333333333333";
const PUBLIC_TOKEN = "demo-public-token-9f2a";

const sharePath = "/users/demo.user/Projects/report.md";
const updatedAt = "2026-07-01T10:00:00.000Z";

const directGrantSource = {
  shareId: MEMBER_SHARE_ID,
  sharePath,
  inherited: false,
  status: "active" as const,
};

const inheritedGrantSource = {
  shareId: MEMBER_SHARE_ID,
  sharePath: "/users/demo.user/Projects",
  inherited: true,
  status: "active" as const,
};

export const mockDriveShareAtPath: DriveShareAtPath = {
  path: sharePath,
  directShares: [
    {
      share: {
        id: MEMBER_SHARE_ID,
        path: sharePath,
        kind: "member",
        defaultAccess: "edit",
        publicToken: null,
        hasPassword: false,
        expiresAt: null,
        updatedAt,
        shareWith: {
          "groups/engineering": { access: "edit" },
          alice: { access: "review" },
        },
        myRights: fullDriveMyRights,
      },
      relationship: "direct",
      status: "active",
    },
    {
      share: {
        id: PUBLIC_SHARE_ID,
        path: sharePath,
        kind: "public",
        defaultAccess: "view",
        publicToken: PUBLIC_TOKEN,
        hasPassword: false,
        expiresAt: null,
        updatedAt,
        shareWith: null,
        myRights: fullDriveMyRights,
      },
      relationship: "direct",
      status: "active",
    },
  ],
  coveringShares: [],
  nestedShares: [],
  grantSources: [
    {
      principal: "groups/engineering",
      principalType: "group",
      access: "edit",
      status: "active",
      source: directGrantSource,
    },
    {
      principal: "alice",
      principalType: "user",
      access: "review",
      status: "active",
      source: inheritedGrantSource,
    },
    {
      principal: "guest@example.com",
      principalType: "email",
      access: "view",
      status: "pending",
      source: directGrantSource,
    },
  ],
  effectiveGrants: [
    {
      principal: "groups/engineering",
      principalType: "group",
      access: "edit",
      displayName: "Engineering",
      memberCount: 12,
      source: directGrantSource,
      removal: {
        method: "patchShareWith",
        shareId: MEMBER_SHARE_ID,
        principal: "groups/engineering",
      },
    },
    {
      principal: "alice",
      principalType: "user",
      access: "review",
      source: inheritedGrantSource,
      removal: {
        method: "patchShareWith",
        shareId: MEMBER_SHARE_ID,
        principal: "alice",
      },
    },
    {
      principal: "guest@example.com",
      principalType: "email",
      access: "view",
      status: "pending",
      inviteId: GUEST_INVITE_ID,
      source: directGrantSource,
      removal: {
        method: "deleteInvite",
        shareId: MEMBER_SHARE_ID,
      },
    },
  ],
  memberAccess: [
    {
      username: "alice",
      displayName: "Alice Chen",
      access: "review",
      viaGroup: null,
      editable: false,
      editConstraint: "groupOnly",
      editHint: "Access is inherited from the Projects folder.",
      source: inheritedGrantSource,
      removal: {
        method: "patchShareWith",
        shareId: MEMBER_SHARE_ID,
        principal: "alice",
      },
    },
    {
      username: "demo.user",
      displayName: "Demo User",
      access: "full",
      viaGroup: null,
      editable: false,
      source: directGrantSource,
      removal: {
        method: "patchShareWith",
        shareId: MEMBER_SHARE_ID,
        principal: "demo.user",
      },
    },
  ],
  publicShares: [
    {
      shareId: PUBLIC_SHARE_ID,
      sharePath,
      defaultAccess: "view",
      hasPassword: false,
      inherited: false,
      status: "active",
    },
  ],
  myRights: fullDriveMyRights,
};

export const mockDriveShareByPrincipal: DriveShareByPrincipal = {
  principal: "alice",
  queriedPrincipalType: "user",
  entries: [
    {
      access: "review",
      principalType: "user",
      status: "active",
      source: inheritedGrantSource,
      relationship: "ancestor",
      removal: {
        method: "patchShareWith",
        shareId: MEMBER_SHARE_ID,
        principal: "alice",
      },
    },
    {
      access: "edit",
      principalType: "user",
      status: "active",
      viaGroup: "groups/engineering",
      source: directGrantSource,
      relationship: "direct",
      removal: {
        method: "patchShareWith",
        shareId: MEMBER_SHARE_ID,
        principal: "groups/engineering",
      },
    },
  ],
};

export const mockDriveSharePrincipals: DriveSharePrincipalEntry[] = [
  {
    principal: "alice",
    principalType: "user",
    displayName: "Alice Chen",
  },
  {
    principal: "groups/engineering",
    principalType: "group",
    displayName: "Engineering",
    memberCount: 12,
  },
];
