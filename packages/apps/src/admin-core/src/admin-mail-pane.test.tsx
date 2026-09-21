import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AdminMailPane } from "@/admin-core/src/admin-mail-pane";
import { useAdminPaneStoryController } from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";

afterEach(() => {
  cleanup();
});

function MailPaneHarness() {
  const controller = useAdminPaneStoryController();
  return (
    <AdminStoryScope>
      <AdminMailPane controller={controller} />
    </AdminStoryScope>
  );
}

describe("AdminMailPane", () => {
  it("updates IMAP and SMTP hosts when the user types", () => {
    render(<MailPaneHarness />);

    const imapHost = screen.getByLabelText("Server", {
      selector: "#admin-mail-imap-host",
    });
    fireEvent.change(imapHost, { target: { value: "imap.typed.test" } });
    expect(screen.getByDisplayValue("imap.typed.test")).toBeTruthy();

    const smtpHost = screen.getByLabelText("Server", {
      selector: "#admin-mail-smtp-host",
    });
    fireEvent.change(smtpHost, { target: { value: "smtp.typed.test" } });
    expect(screen.getByDisplayValue("smtp.typed.test")).toBeTruthy();
  });

  it("updates IMAP and SMTP ports when the user types", () => {
    render(<MailPaneHarness />);

    const imapPort = screen.getByLabelText("Port", {
      selector: "#admin-mail-imap-port",
    });
    fireEvent.change(imapPort, { target: { value: "143" } });
    expect(screen.getByDisplayValue("143")).toBeTruthy();

    const smtpPort = screen.getByLabelText("Port", {
      selector: "#admin-mail-smtp-port",
    });
    fireEvent.change(smtpPort, { target: { value: "25" } });
    expect(screen.getByDisplayValue("25")).toBeTruthy();
  });
});
