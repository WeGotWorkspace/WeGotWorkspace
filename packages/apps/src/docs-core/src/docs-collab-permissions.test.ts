import { describe, expect, it } from "vitest";
import {
  resolveDocsCollabFormatBarMode,
  resolveDocsCollabPermissions,
  resolveDocsCollabPermissionsWhileLoading,
} from "./docs-collab-permissions";

describe("resolveDocsCollabPermissions", () => {
  it("defaults to full access when rights are unknown", () => {
    expect(resolveDocsCollabPermissions(undefined)).toEqual({
      editable: true,
      canComment: true,
      canReview: true,
    });
    expect(resolveDocsCollabPermissions(null)).toEqual({
      editable: true,
      canComment: true,
      canReview: true,
    });
  });

  it("maps view access to read-only without comments", () => {
    expect(
      resolveDocsCollabPermissions({
        mayEditContent: false,
        mayComment: false,
        mayReview: false,
      }),
    ).toEqual({
      editable: false,
      canComment: false,
      canReview: false,
    });
  });

  it("maps comment access to non-editable with commenting", () => {
    expect(
      resolveDocsCollabPermissions({
        mayEditContent: false,
        mayComment: true,
        mayReview: false,
      }),
    ).toEqual({
      editable: false,
      canComment: true,
      canReview: false,
    });
  });

  it("does not unlock the editor from legacy mayReview alone", () => {
    expect(
      resolveDocsCollabPermissions({
        mayEditContent: false,
        mayComment: true,
        mayReview: true,
      }),
    ).toEqual({
      editable: false,
      canComment: true,
      canReview: false,
    });
  });

  it("maps edit access to content edit plus suggest mode and comments", () => {
    expect(
      resolveDocsCollabPermissions({
        mayEditContent: true,
        mayComment: true,
        mayReview: true,
      }),
    ).toEqual({
      editable: true,
      canComment: true,
      canReview: true,
    });
  });
});

describe("resolveDocsCollabPermissionsWhileLoading", () => {
  it("locks the editor while rights are still loading", () => {
    expect(resolveDocsCollabPermissionsWhileLoading(null, true)).toEqual({
      editable: false,
      canComment: false,
      canReview: false,
    });
  });

  it("uses loaded rights once available", () => {
    expect(
      resolveDocsCollabPermissionsWhileLoading(
        { mayEditContent: true, mayComment: true, mayReview: true },
        true,
      ),
    ).toEqual({
      editable: true,
      canComment: true,
      canReview: true,
    });
  });
});

describe("resolveDocsCollabFormatBarMode", () => {
  it("hides the bar for view access", () => {
    expect(
      resolveDocsCollabFormatBarMode({
        editable: false,
        canComment: false,
        canReview: false,
      }),
    ).toBe("hidden");
  });

  it("keeps the bar with formatting disabled for comment access", () => {
    expect(
      resolveDocsCollabFormatBarMode({
        editable: false,
        canComment: true,
        canReview: false,
      }),
    ).toBe("commentOnly");
  });

  it("shows a full bar for edit access", () => {
    expect(
      resolveDocsCollabFormatBarMode({
        editable: true,
        canComment: true,
        canReview: true,
      }),
    ).toBe("full");
  });
});
