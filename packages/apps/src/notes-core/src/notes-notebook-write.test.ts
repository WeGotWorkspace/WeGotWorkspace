import { describe, expect, it } from "vitest";
import {
  canChangeNotebookOwner,
  canDeleteNotebook,
  isDefaultNotebook,
  isProvisionedGroupNotebook,
} from "@/notes-core/src/notes-notebook-write";

describe("isDefaultNotebook", () => {
  it("uses API isDefault and role: general", () => {
    expect(isDefaultNotebook({ isDefault: true })).toBe(true);
    expect(isDefaultNotebook({ role: "general" })).toBe(true);
    expect(isDefaultNotebook({ isDefault: false, role: null })).toBe(false);
    expect(isDefaultNotebook({ role: "group" })).toBe(false);
    expect(isDefaultNotebook()).toBe(false);
  });
});

describe("isProvisionedGroupNotebook", () => {
  it("flags the Administrators home and other group-{slug} rows", () => {
    expect(
      isProvisionedGroupNotebook({
        id: "group-administrators",
        role: "group",
        scope: "group",
        groupSlug: "administrators",
      }),
    ).toBe(true);
    expect(
      isProvisionedGroupNotebook({
        id: "group-administrators",
        scope: "group",
        groupSlug: "administrators",
      }),
    ).toBe(true);
    expect(
      isProvisionedGroupNotebook({
        id: "notes-team-roadmap",
        scope: "group",
        groupSlug: "administrators",
      }),
    ).toBe(false);
  });
});

describe("canDeleteNotebook", () => {
  it("allows ordinary owned notebooks", () => {
    expect(canDeleteNotebook({ isDefault: false, isSharee: false })).toBe(true);
    expect(canDeleteNotebook({ myRights: { mayDelete: true } })).toBe(true);
  });

  it("hides owner delete for default, Administrators, sharee, and mayDelete false", () => {
    expect(canDeleteNotebook({ isDefault: true })).toBe(false);
    expect(canDeleteNotebook({ role: "general" })).toBe(false);
    expect(
      canDeleteNotebook({
        id: "group-administrators",
        role: "group",
        scope: "group",
        groupSlug: "administrators",
      }),
    ).toBe(false);
    expect(canDeleteNotebook({ isSharee: true })).toBe(false);
    expect(canDeleteNotebook({ myRights: { mayDelete: false } })).toBe(false);
    expect(canDeleteNotebook()).toBe(false);
  });
});

describe("canChangeNotebookOwner", () => {
  it("locks default, provisioned group, and sharee notebooks", () => {
    expect(canChangeNotebookOwner({ isDefault: false, isSharee: false })).toBe(true);
    expect(canChangeNotebookOwner({ isDefault: true })).toBe(false);
    expect(canChangeNotebookOwner({ role: "general" })).toBe(false);
    expect(
      canChangeNotebookOwner({
        id: "group-administrators",
        role: "group",
        scope: "group",
        groupSlug: "administrators",
      }),
    ).toBe(false);
    expect(canChangeNotebookOwner({ isSharee: true })).toBe(false);
    expect(canChangeNotebookOwner()).toBe(false);
  });
});
