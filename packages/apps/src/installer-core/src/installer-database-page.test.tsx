import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InstallerDatabasePage } from "@/installer-core/src/installer-database-page";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: "/install" } }),
  Link: ({ to, children }: { to: string; children: string }) => <a href={to}>{children}</a>,
}));

describe("InstallerDatabasePage", () => {
  it("defaults to MySQL with connection fields", () => {
    render(<InstallerDatabasePage />);
    expect(screen.getByRole("heading", { name: "Your data." })).toBeTruthy();
    expect(document.querySelector(".installer__hero-your")?.textContent).toBe("Your");
    expect(document.querySelector(".installer__hero-noun")?.textContent).toBe("data");
    const engines = within(screen.getByRole("group", { name: "Database type" })).getAllByRole(
      "button",
    );
    expect(engines[0].getAttribute("aria-label")).toBe("MySQL / MariaDB");
    expect(engines[0].getAttribute("aria-pressed")).toBe("true");
    expect(engines[1].getAttribute("aria-label")).toBe("SQLite");
    expect(screen.getByLabelText("Host")).toBeTruthy();
    expect(screen.getByLabelText("Port")).toBeTruthy();
    expect(screen.getByLabelText("Database")).toBeTruthy();
    expect(screen.getByLabelText("User")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(document.querySelector(".installer__mysql-row--host-port")).toBeTruthy();
    expect(document.querySelector(".installer__mysql-host")).toBeTruthy();
    const panels = document.querySelectorAll(".installer__engine-panel");
    expect(panels).toHaveLength(2);
    expect(panels[0].classList.contains("installer__engine-panel--hidden")).toBe(false);
    expect(panels[1].classList.contains("installer__engine-panel--hidden")).toBe(true);
    expect(panels[1].getAttribute("aria-hidden")).toBe("true");
    expect(panels[1].textContent).toContain("Uses the default SQLite file.");
    expect(screen.queryByLabelText("Database file")).toBeNull();
    const progress = screen.getByRole("list", { name: "Setup progress" });
    expect(within(progress).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("Your data, current")).toBeTruthy();
  });

  it("shows SQLite hint when that engine is chosen", () => {
    render(<InstallerDatabasePage />);
    fireEvent.click(screen.getByRole("button", { name: "SQLite" }));
    expect(screen.getByText("Uses the default SQLite file.")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Host" })).toBeNull();
    expect(screen.queryByLabelText("Database file")).toBeNull();
    const panels = document.querySelectorAll(".installer__engine-panel");
    expect(panels[0].classList.contains("installer__engine-panel--hidden")).toBe(true);
    expect(panels[1].classList.contains("installer__engine-panel--hidden")).toBe(false);
  });

  it("shows a connection error above Continue", () => {
    render(
      <InstallerDatabasePage connectionError="Could not reach MySQL at 127.0.0.1:3306. Check the host and port, or use SQLite." />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Could not reach MySQL");
  });

  it("uses the suggested data folder as placeholder and leaves it to the server when empty", () => {
    const onContinue = vi.fn();
    render(
      <InstallerDatabasePage
        initialEngine="sqlite"
        dataDirPath="/home/user/wgw-content"
        onContinue={onContinue}
      />,
    );
    const field = screen.getByLabelText("Data folder") as HTMLInputElement;
    expect(field.placeholder).toBe("/home/user/wgw-content");
    expect(field.value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledWith({ engine: "sqlite" });
  });

  it("submits a typed data folder", () => {
    const onContinue = vi.fn();
    render(
      <InstallerDatabasePage
        initialEngine="sqlite"
        dataDirPath="/home/user/wgw-content"
        onContinue={onContinue}
      />,
    );
    fireEvent.change(screen.getByLabelText("Data folder"), {
      target: { value: "/srv/wgw-data" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledWith({
      engine: "sqlite",
      dataDir: "/srv/wgw-data",
    });
  });

  it("warns when the suggested data folder is inside the website", () => {
    render(
      <InstallerDatabasePage
        initialEngine="sqlite"
        dataDirPath="/var/www/html/wgw-content"
        dataDirInsideWebRoot
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/inside the website/i);
    fireEvent.change(screen.getByLabelText("Data folder"), {
      target: { value: "/var/wgw-data" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("moves a published-folder rejection under the field until the path changes", () => {
    const { rerender } = render(
      <InstallerDatabasePage initialEngine="sqlite" dataDirPath="/home/user/wgw-content" />,
    );
    fireEvent.change(screen.getByLabelText("Data folder"), {
      target: { value: "/var/www/html/data" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    rerender(
      <InstallerDatabasePage
        initialEngine="sqlite"
        dataDirPath="/home/user/wgw-content"
        connectionError="That directory is inside the published website. Choose a folder outside it."
      />,
    );
    const field = screen.getByLabelText("Data folder");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert").textContent).toMatch(/inside the website/i);
    fireEvent.change(field, { target: { value: "/var/wgw-data" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows other data folder rejections under the field too", () => {
    const { rerender } = render(
      <InstallerDatabasePage initialEngine="sqlite" dataDirPath="/home/user/wgw-content" />,
    );
    fireEvent.change(screen.getByLabelText("Data folder"), {
      target: { value: "/srv/locked" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    rerender(
      <InstallerDatabasePage
        initialEngine="sqlite"
        dataDirPath="/home/user/wgw-content"
        connectionError="That directory is not writable by the web server."
      />,
    );
    expect(screen.getByLabelText("Data folder").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert").textContent).toContain("not writable by the web server");
  });

  it("submits sqlite without credentials", () => {
    const onContinue = vi.fn();
    render(<InstallerDatabasePage initialEngine="sqlite" onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledWith({ engine: "sqlite" });
  });

  it("keeps MySQL defaults when the API omits connection fields", () => {
    render(
      <InstallerDatabasePage
        initialMysql={{
          host: undefined,
          port: undefined,
          database: undefined,
          username: undefined,
        }}
      />,
    );
    expect((screen.getByLabelText("Host") as HTMLInputElement).value).toBe("127.0.0.1");
    expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe("3306");
    expect((screen.getByLabelText("Database") as HTMLInputElement).value).toBe("wgw");
    expect((screen.getByLabelText("User") as HTMLInputElement).value).toBe("wgw");
  });

  it("submits mysql credentials by default", () => {
    const onContinue = vi.fn();
    render(<InstallerDatabasePage onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledWith({
      engine: "mysql",
      mysql: {
        host: "127.0.0.1",
        port: "3306",
        database: "wgw",
        username: "wgw",
        password: "",
      },
    });
  });
});
