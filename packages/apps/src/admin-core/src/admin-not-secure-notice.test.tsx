import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { adminCopy } from "@/admin-core/src/admin-copy";
import { AdminNotSecureNotice } from "@/admin-core/src/admin-not-secure-notice";

describe("AdminNotSecureNotice", () => {
  it("shows over http, with nothing to dismiss it", () => {
    render(<AdminNotSecureNotice secureContext={false} />);

    expect(screen.getByText(adminCopy.notSecureTitle)).toBeTruthy();
    expect(screen.getByText(adminCopy.notSecureMessage)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("stays away on https or localhost", () => {
    const { container } = render(<AdminNotSecureNotice secureContext />);

    expect(container.textContent).toBe("");
  });
});
