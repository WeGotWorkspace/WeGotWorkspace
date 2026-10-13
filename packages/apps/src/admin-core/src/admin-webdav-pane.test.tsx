import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AdminWebdavPane } from "@/admin-core/src/admin-webdav-pane";
import { useAdminPaneStoryController } from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";

afterEach(() => {
  cleanup();
});

function WebdavPaneHarness() {
  const controller = useAdminPaneStoryController();
  return (
    <AdminStoryScope>
      <AdminWebdavPane controller={controller} />
    </AdminStoryScope>
  );
}

describe("AdminWebdavPane", () => {
  it("updates auth realm and base URI when the user types", () => {
    render(<WebdavPaneHarness />);

    const authRealm = screen.getByLabelText("Auth realm");
    fireEvent.change(authRealm, { target: { value: "typed-realm" } });
    expect(screen.getByDisplayValue("typed-realm")).toBeTruthy();

    const baseUri = screen.getByLabelText("Base URI");
    fireEvent.change(baseUri, { target: { value: "/typed-dav/" } });
    expect(screen.getByDisplayValue("/typed-dav/")).toBeTruthy();
  });

  it("shows the external invitation switch and hourly limit", () => {
    render(<WebdavPaneHarness />);

    expect(screen.getByLabelText("External invitations enabled")).toBeTruthy();
    expect(screen.getByLabelText("Hourly invitation limit")).toBeTruthy();
  });

  it("keeps the hourly limit empty while the field is cleared", () => {
    render(<WebdavPaneHarness />);

    const limit = screen.getByLabelText("Hourly invitation limit");
    fireEvent.change(limit, { target: { value: "" } });
    expect(limit).toHaveProperty("value", "");

    fireEvent.change(limit, { target: { value: "42" } });
    expect(limit).toHaveProperty("value", "42");
  });
});
