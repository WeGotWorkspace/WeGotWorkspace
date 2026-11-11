import { describe, expect, it } from "vitest";
import {
  docAttachmentsFolderPath,
  drivePrincipalPrefix,
  imageExtensionForFile,
  noteAttachmentsFolderPath,
} from "./docs-image-upload";

const DOC_ID = "fn-cccccccccccccccccccccccccccccccc";

describe("docs image upload paths", () => {
  it("keys the hidden attachments folder by the Doc FileNode id", () => {
    expect(drivePrincipalPrefix("/users/bob/docs/report.md")).toBe("/users/bob");
    expect(drivePrincipalPrefix("/groups/team/handbook.md")).toBe("/groups/team");
    expect(docAttachmentsFolderPath("/users/bob/docs/report.md", DOC_ID)).toBe(
      `/users/bob/.attachments/${DOC_ID}`,
    );
  });

  it("keys a note's hidden image folder by its uid under the owner principal (#1623)", () => {
    const uid = "0F8FAD5B-D9CB-469F-A165-70867728950E";
    expect(noteAttachmentsFolderPath("/users/bob", uid)).toBe(
      "/users/bob/.attachments/note-0f8fad5b-d9cb-469f-a165-70867728950e",
    );
    expect(noteAttachmentsFolderPath("/groups/team", "abc")).toBe(
      "/groups/team/.attachments/note-abc",
    );
    expect(noteAttachmentsFolderPath("/users/bob", "../x")).toBeNull();
    expect(noteAttachmentsFolderPath("/elsewhere", "abc")).toBeNull();
  });

  it("picks a file extension from the name or MIME type", () => {
    expect(imageExtensionForFile(new File([], "photo.JPEG", { type: "image/jpeg" }))).toBe("jpeg");
    expect(imageExtensionForFile(new File([], "blob", { type: "image/png" }))).toBe("png");
  });
});
