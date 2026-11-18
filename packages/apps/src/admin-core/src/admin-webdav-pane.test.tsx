import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AdminWebdavPane } from "@/admin-core/src/admin-webdav-pane";
import { useAdminPaneStoryController } from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminPaneScope } from "@/admin-core/stories/admin-story-scope";

afterEach(() => {
  cleanup();
});

function WebdavPaneHarness() {
  const controller = useAdminPaneStoryController();
  return (
    <AdminPaneScope controller={controller}>
      <AdminWebdavPane controller={controller} />
    </AdminPaneScope>
  );
}

describe("AdminWebdavPane", () => {
  it("updates auth realm and base URI when the user types", () => {
    render(<WebdavPaneHarness />);

    const authRealm = screen.getByLabelText("Sign-in realm");
    fireEvent.change(authRealm, { target: { value: "typed-realm" } });
    expect(screen.getByDisplayValue("typed-realm")).toBeTruthy();

    const baseUri = screen.getByLabelText("Base path");
    fireEvent.change(baseUri, { target: { value: "/typed-dav/" } });
    expect(screen.getByDisplayValue("/typed-dav/")).toBeTruthy();
  });
});
