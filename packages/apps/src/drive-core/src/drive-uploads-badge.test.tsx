/** @vitest-environment jsdom */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DriveUploadsBadge } from "@/drive-core/src/drive-uploads-badge";

describe("DriveUploadsBadge (#1522)", () => {
  it("shows the pause sign while the server is full, although a file failed", () => {
    const { container } = render(<DriveUploadsBadge count={3} failed={1} paused />);
    expect(container.querySelector("svg.lucide-circle-pause")).not.toBeNull();
    expect(container.querySelector("svg.lucide-circle-alert")).toBeNull();
    expect(container.textContent).toContain("3 files, paused, the server is full");
    expect(container.textContent).not.toContain("1 failed");
  });

  it("shows the error sign when files failed and nothing is paused", () => {
    const { container } = render(<DriveUploadsBadge count={3} failed={1} />);
    expect(container.querySelector("svg.lucide-circle-alert")).not.toBeNull();
  });
});
