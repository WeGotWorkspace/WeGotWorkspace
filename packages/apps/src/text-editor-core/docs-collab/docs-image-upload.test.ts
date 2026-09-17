import { describe, expect, it } from "vitest";
import {
  docAttachmentsFolderPath,
  drivePrincipalPrefix,
  imageExtensionForFile,
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

  it("picks a file extension from the name or MIME type", () => {
    expect(imageExtensionForFile(new File([], "photo.JPEG", { type: "image/jpeg" }))).toBe("jpeg");
    expect(imageExtensionForFile(new File([], "blob", { type: "image/png" }))).toBe("png");
  });
});
