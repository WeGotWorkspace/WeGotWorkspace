import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  INSTALL_FIELD_FEEDBACK_SHOW_DEBOUNCE_MS,
  InstallFirstRunAccount,
} from "@/install-core/src/install-first-run-account";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: "/install" } }),
  Link: ({ to, children }: { to: string; children: string }) => <a href={to}>{children}</a>,
}));

describe("InstallFirstRunAccount", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks for username, email, and password", () => {
    render(
      <InstallFirstRunAccount
        initialUsername="jane"
        initialEmail="jane@example.com"
        initialPassword="hunter2hunter"
      />,
    );
    expect(screen.getByRole("heading", { name: "Your account." })).toBeTruthy();
    expect(screen.getByLabelText("Username")).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByText("Used if you forget your password.")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByText("At least 10 characters.")).toBeTruthy();
    expect(screen.queryByLabelText("Full name")).toBeNull();
    expect(screen.queryByLabelText("Confirm password")).toBeNull();
    expect(screen.queryByText(/You'll sign in as/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Use MySQL / MariaDB" })).toBeNull();
    expect(screen.queryByRole("button", { name: "SQLite" })).toBeNull();
  });

  it("keeps an email-shaped value in the username field", () => {
    render(<InstallFirstRunAccount />);
    const username = screen.getByLabelText("Username");
    expect(username.getAttribute("type")).not.toBe("email");
    fireEvent.change(username, { target: { value: "jane@example.com" } });
    expect((username as HTMLInputElement).value).toBe("jane@example.com");
    expect(screen.getByLabelText("Email")).toBeTruthy();
  });

  it("submits account values including email without a confirm-password field", () => {
    const onCreateWorkspace = vi.fn();
    render(
      <InstallFirstRunAccount
        initialUsername="jane"
        initialEmail="jane@example.com"
        initialPassword="hunter2hunter"
        onCreateWorkspace={onCreateWorkspace}
      />,
    );
    expect(screen.queryByLabelText("Confirm password")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    expect(onCreateWorkspace).toHaveBeenCalledWith({
      username: "jane",
      email: "jane@example.com",
      password: "hunter2hunter",
    });
  });

  it("collapses username feedback until an invalid slug is shown", () => {
    vi.useFakeTimers();
    const { container } = render(<InstallFirstRunAccount initialUsername="jane" />);
    const usernameField = container.querySelectorAll(".install-first-run__field")[0];
    const feedback = usernameField?.querySelector(".install-first-run__field-feedback");
    expect(feedback).toBeTruthy();
    expect(feedback?.classList.contains("install-first-run__field-feedback--hidden")).toBe(true);
    expect(feedback?.hasAttribute("aria-live")).toBe(false);
    expect(screen.queryByText("Use 2–63 lowercase letters, numbers, - or _.")).toBeNull();

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "j" } });
    expect(screen.queryByText("Use 2–63 lowercase letters, numbers, - or _.")).toBeNull();
    expect(feedback?.classList.contains("install-first-run__field-feedback--hidden")).toBe(true);

    act(() => {
      vi.advanceTimersByTime(INSTALL_FIELD_FEEDBACK_SHOW_DEBOUNCE_MS);
    });
    expect(screen.getByText("Use 2–63 lowercase letters, numbers, - or _.")).toBeTruthy();
    expect(feedback?.classList.contains("install-first-run__field-feedback--hidden")).toBe(false);
    expect(feedback?.getAttribute("aria-live")).toBe("polite");
    expect(usernameField?.querySelectorAll(".install-first-run__field-feedback")).toHaveLength(1);
  });

  it("debounces username invalid feedback while typing and hides immediately when fixed", () => {
    vi.useFakeTimers();
    const { container } = render(<InstallFirstRunAccount initialUsername="jane" />);
    const usernameField = container.querySelectorAll(".install-first-run__field")[0];
    const feedback = usernameField?.querySelector(".install-first-run__field-feedback");
    const username = screen.getByLabelText("Username");
    const invalidMessage = "Use 2–63 lowercase letters, numbers, - or _.";

    fireEvent.change(username, { target: { value: "j" } });
    expect(screen.queryByText(invalidMessage)).toBeNull();
    expect(feedback?.classList.contains("install-first-run__field-feedback--hidden")).toBe(true);

    act(() => {
      vi.advanceTimersByTime(INSTALL_FIELD_FEEDBACK_SHOW_DEBOUNCE_MS - 1);
    });
    expect(screen.queryByText(invalidMessage)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText(invalidMessage)).toBeTruthy();
    expect(feedback?.classList.contains("install-first-run__field-feedback--hidden")).toBe(false);
    expect(feedback?.getAttribute("aria-live")).toBe("polite");

    fireEvent.change(username, { target: { value: "jane" } });
    expect(screen.queryByText(invalidMessage)).toBeNull();
    expect(feedback?.classList.contains("install-first-run__field-feedback--hidden")).toBe(true);
  });

  it("shows a taken username in the username feedback slot immediately", () => {
    const { container } = render(<InstallFirstRunAccount initialUsername="jane" usernameTaken />);
    const feedback = container.querySelector(".install-first-run__field-feedback");
    expect(screen.getByText("That username is taken. Pick another.")).toBeTruthy();
    expect(feedback?.classList.contains("install-first-run__field-feedback--hidden")).toBe(false);
    expect(screen.queryByText("Use 2–63 lowercase letters, numbers, - or _.")).toBeNull();
  });

  it("disables Create workspace until the email is valid without waiting for feedback", () => {
    vi.useFakeTimers();
    render(<InstallFirstRunAccount initialUsername="jane" initialPassword="hunter2hunter" />);
    const submit = screen.getByRole("button", { name: "Create workspace" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    const email = screen.getByLabelText("Email");
    fireEvent.change(email, { target: { value: "not-an-email" } });
    expect(submit.disabled).toBe(true);
    expect(screen.queryByText("Enter a valid email address.")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(INSTALL_FIELD_FEEDBACK_SHOW_DEBOUNCE_MS);
    });
    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
    expect(submit.disabled).toBe(true);

    fireEvent.change(email, { target: { value: "jane@example.com" } });
    expect(submit.disabled).toBe(false);
    expect(screen.queryByText("Enter a valid email address.")).toBeNull();
  });

  it("keeps Database in the progress dots after that step", () => {
    render(<InstallFirstRunAccount initialUsername="jane" />);
    const progress = screen.getByRole("list", { name: "Setup progress" });
    expect(within(progress).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("Database, done")).toBeTruthy();
    expect(screen.getByText("Your account, current")).toBeTruthy();
  });

  it("omits the Database dot when env already supplied the database", () => {
    render(<InstallFirstRunAccount initialUsername="jane" includeDatabaseStep={false} />);
    const progress = screen.getByRole("list", { name: "Setup progress" });
    expect(within(progress).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByText(/^Database/)).toBeNull();
    expect(screen.getByText("Your account, current")).toBeTruthy();
  });

  it("shows a single install step with a spinner marker while installing", () => {
    const { container } = render(
      <InstallFirstRunAccount
        initialUsername="jane"
        initialEmail="jane@example.com"
        initialPassword="hunter2hunter"
        installing
      />,
    );

    const installProgress = screen.getByRole("list", { name: "Installation progress" });
    const items = within(installProgress).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toContain("Creating your workspace");
    expect(items[0]?.getAttribute("aria-current")).toBe("step");
    expect(screen.queryByText("Preparing your site")).toBeNull();
    expect(screen.queryByText("Checking the server")).toBeNull();
    expect(screen.queryByText("Setting up your workspace...")).toBeNull();

    const markers = container.querySelectorAll(".install-first-run__progress-marker");
    expect(markers).toHaveLength(1);
    expect(markers[0]?.querySelector(".install-first-run__spinner")).toBeTruthy();
  });
});
