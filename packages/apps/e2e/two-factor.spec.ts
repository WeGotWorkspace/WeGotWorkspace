// Two-factor sign-in end to end (#2276, Epic #2270), on the live app and API.
//
// One user of its own, so `admin` and `member` (which every other live spec signs
// in as) never get a second step. Codes come from the setup key the app shows,
// through `helpers/totp.ts`. The cases run in order on that one user: turn it on,
// sign in with a code, use a recovery code and set up a new authenticator, let a
// calendar app in with an app password (and refuse the account password), then
// an admin reset.
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api, OWNER, passwordFor } from "./helpers/live-matrix";
import { expect, test, type Browser, type Page } from "./helpers/live-test";
import { Authenticator } from "./helpers/totp";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const APP = process.env.WGW_APPS_E2E_BASE_URL ?? "http://127.0.0.1:5173";
const apiPackage = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../api");
const appRoot = path.resolve(apiPackage, "../../apps/wegotworkspace");

const USER = `e2e-2fa-${Date.now().toString(36)}`;
const DISPLAY_NAME = "E2E Two-factor";
const PASSWORD = passwordFor(USER);

// Each code is a new 30-second step, so a case can wait up to a step for its code.
test.describe.configure({ mode: "serial", timeout: 150_000 });
test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

let authenticator: Authenticator;
let recoveryCodes: string[] = [];
let appPassword = "";

/** A fresh browser with no session: a new person on the sign-in page. */
async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    baseURL: APP,
    storageState: { cookies: [], origins: [] },
  });
  return context.newPage();
}

async function submitPassword(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Username", { exact: true }).fill(USER);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/**
 * Opens Settings and waits until it stays put. Right after load the Settings
 * workspace mounts again, up to three times within about a second (every pane, not
 * only this one), and drops an open dialog and whatever was typed in it.
 */
async function openSettings(page: Page, pane: string): Promise<void> {
  await page.goto(`/settings/${pane}`);
  await expect(async () => {
    const workspace = page.locator(".settings-workspace");
    await workspace.evaluate((node) => node.setAttribute("data-e2e-seen", ""));
    await page.waitForTimeout(1_500);
    await expect(page.locator(".settings-workspace[data-e2e-seen]")).toHaveCount(1, {
      timeout: 100,
    });
  }).toPass({ timeout: 20_000 });
}

/** Opens a dialog from a button once Settings is stable. */
async function openDialog(page: Page, button: string, dialog: string) {
  await page.getByRole("button", { name: button }).click();
  const opened = page.getByRole("dialog", { name: dialog });
  await expect(opened).toBeVisible();
  return opened;
}

async function expectSignedIn(page: Page): Promise<void> {
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
}

/** The setup key as the app shows it (groups of four), without the spaces. */
async function readSetupKey(page: Page): Promise<string> {
  const value = await page.getByLabel("Setup key", { exact: true }).inputValue();
  return value.replace(/\s+/g, "");
}

async function readRecoveryCodes(page: Page): Promise<string[]> {
  const list = page.getByRole("list", { name: "Recovery code" });
  await expect(list.getByRole("listitem")).toHaveCount(10);
  return list.getByRole("listitem").allInnerTexts();
}

/** PROPFIND on the user's calendar home, the way a calendar app starts a sync. */
async function davPropfind(password: string, base = API): Promise<number> {
  const res = await fetch(`${base}/calendars/${USER}/`, {
    method: "PROPFIND",
    headers: {
      Authorization: `Basic ${Buffer.from(`${USER}:${password}`).toString("base64")}`,
      Depth: "0",
    },
  });
  await res.arrayBuffer();
  return res.status;
}

async function tokenStatus(): Promise<string> {
  const res = await fetch(`${API}/api/v1/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { status: string }).status;
}

test.beforeAll(async () => {
  const created = await api(OWNER, "POST", "/admin/users", {
    username: USER,
    password: PASSWORD,
    displayName: DISPLAY_NAME,
    email: `${USER}@example.test`,
  });
  expect(created.status, JSON.stringify(created.json)).toBeLessThan(300);
});

test.afterAll(async () => {
  await api(OWNER, "DELETE", `/admin/users/${USER}`);
});

test("turns on two-factor in Settings and signs in with a code", async ({ browser }) => {
  const page = await freshPage(browser);
  await submitPassword(page);
  await expectSignedIn(page);

  await openSettings(page, "security");
  await expect(page.getByText("Off", { exact: true })).toBeVisible();
  const setup = await openDialog(page, "Turn on", "Turn on two-factor sign-in");
  await setup.getByLabel("Account password", { exact: true }).fill(PASSWORD);
  await setup.getByRole("button", { name: "Next" }).click();

  authenticator = new Authenticator(await readSetupKey(page));
  await setup.getByLabel("Code", { exact: true }).fill(await authenticator.next()); // the sixth digit submits

  recoveryCodes = await readRecoveryCodes(page);
  expect(recoveryCodes[0]).toMatch(/^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/);
  await page.getByLabel("I saved these codes somewhere safe").check();
  await page.getByRole("button", { name: "Done" }).click();

  // Turning it on ends every session, also this one.
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });

  // The password alone no longer signs in.
  expect(await tokenStatus()).toBe("mfa_required");

  await submitPassword(page);
  await expect(page.getByRole("heading", { name: "Two-factor auth" })).toBeVisible();
  await page.getByLabel("Code", { exact: true }).fill(await authenticator.next()); // the sixth digit submits
  await expectSignedIn(page);

  await openSettings(page, "security");
  await expect(page.getByText("On", { exact: true })).toBeVisible();
  await expect(page.getByText(/^10 of 10 left/)).toBeVisible();
  await page.context().close();
});

test("a recovery code signs in and sets up a new authenticator", async ({ browser }) => {
  const page = await freshPage(browser);
  await submitPassword(page);
  await expect(page.getByRole("heading", { name: "Two-factor auth" })).toBeVisible();
  await page.getByRole("button", { name: "Use a recovery code" }).click();
  // Typed the way people copy it: spaces instead of dashes.
  await page
    .getByLabel("Recovery code", { exact: true })
    .fill(recoveryCodes[0]!.replaceAll("-", " "));
  await page.getByRole("button", { name: "Verify" }).click();

  await expect(page.getByRole("heading", { name: "Set up your app again." })).toBeVisible();
  authenticator.replaceSecret(await readSetupKey(page));
  await page.getByLabel("Code", { exact: true }).fill(await authenticator.next()); // the sixth digit submits

  await expect(page.getByRole("heading", { name: "Save your new recovery codes." })).toBeVisible();
  const fresh = await readRecoveryCodes(page);
  expect(fresh).not.toContain(recoveryCodes[1]);
  recoveryCodes = fresh;
  await page.getByLabel("I saved these codes somewhere safe").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expectSignedIn(page);
  await page.context().close();
});

test("a calendar app signs in with an app password; the account password is refused", async ({
  browser,
}) => {
  const page = await freshPage(browser);
  await submitPassword(page);
  await page.getByLabel("Code", { exact: true }).fill(await authenticator.next()); // the sixth digit submits
  await expectSignedIn(page);

  await openSettings(page, "security");
  await expect(page.getByText("No app passwords yet.")).toBeVisible();
  const dialog = await openDialog(page, "Create app password", "New app password");
  await dialog.getByLabel("Name", { exact: true }).fill("Calendar on the laptop");
  // With two-factor on, creating one asks for a code, not the account password.
  await expect(dialog.getByLabel("Account password", { exact: true })).toHaveCount(0);
  await dialog.getByLabel("Code", { exact: true }).fill(await authenticator.next()); // the sixth digit submits
  appPassword = await page.getByLabel("App password", { exact: true }).inputValue();
  expect(appPassword).toMatch(/^[a-z]{4} [a-z]{4} [a-z]{4} [a-z]{4}$/);
  await page.getByRole("button", { name: "Done" }).click();

  expect(await davPropfind(appPassword)).toBe(207);
  // Clients may send it without the spaces.
  expect(await davPropfind(appPassword.replaceAll(" ", ""))).toBe(207);
  expect(await davPropfind(PASSWORD)).toBe(401);

  // The row says which app used it last.
  await page.reload();
  await expect(page.getByText("Calendar on the laptop")).toBeVisible();
  await expect(page.getByText(/Last used/)).toBeVisible();
  await page.context().close();
});

test("account-password failures throttle the user; a valid app password still gets 207", async () => {
  // The live tier runs its API with `WGW_DISABLE_LOGIN_THROTTLE=1`. A second PHP server on
  // the same database and cache, without that switch, has the real protocol limit.
  test.skip(
    !["127.0.0.1", "localhost"].includes(new URL(API).hostname),
    "starts a second API on this machine",
  );
  const port = 9000 + Math.floor(Math.random() * 400) + 500;
  const throttled = `http://127.0.0.1:${port}`;
  const env = { ...process.env };
  delete env.WGW_DISABLE_LOGIN_THROTTLE;
  delete env.SABRE_BUILD_DIR;
  const server: ChildProcess = spawn(
    "php",
    [
      "-d",
      "display_errors=0",
      "-S",
      `127.0.0.1:${port}`,
      "-t",
      appRoot,
      path.join(appRoot, "index.php"),
    ],
    { cwd: apiPackage, env, stdio: "ignore" },
  );
  try {
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(`${throttled}/api/v1/health`)).status;
          } catch {
            return 0;
          }
        },
        { timeout: 20_000 },
      )
      .toBe(200);

    // An old client that still sends the account password: 401 until the limit, then 429.
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      statuses.push(await davPropfind(PASSWORD, throttled));
    }
    expect(statuses[0]).toBe(401);
    expect(statuses.at(-1)).toBe(429);

    // The limit only blocks account-password attempts: the app password still syncs.
    expect(await davPropfind(appPassword, throttled)).toBe(207);
    expect(await davPropfind(PASSWORD, throttled)).toBe(429);
  } finally {
    server.kill("SIGTERM");
  }
});

test("an admin reset lets the user sign in with the password alone", async ({ browser }) => {
  // The admin's own session from the tier's global setup.
  const admin = await browser.newContext({
    baseURL: APP,
    storageState: path.join(path.dirname(fileURLToPath(import.meta.url)), ".auth", "admin.json"),
  });
  const page = await admin.newPage();
  await page.goto("/admin/users");
  const confirm = page.getByRole("alertdialog");
  const resetItem = page.getByRole("menuitem", { name: "Reset two-factor sign-in" });
  const openRowMenu = () => page.getByRole("button", { name: `More options: ${DISPLAY_NAME}` });
  await expect(async () => {
    if (!(await confirm.isVisible())) {
      await openRowMenu().click();
      await resetItem.click();
    }
    await expect(confirm).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expect(confirm.getByText(`Reset two-factor sign-in for ${DISPLAY_NAME}?`)).toBeVisible();
  await confirm.getByRole("button", { name: /^Reset/ }).click();
  await expect(confirm).toBeHidden();
  await openRowMenu().click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(resetItem).toHaveCount(0);
  await admin.close();

  expect(await tokenStatus()).toBe("ok");
  // App passwords survive a reset; only the authenticator and its sessions are gone.
  expect(await davPropfind(appPassword)).toBe(207);

  const user = await freshPage(browser);
  await submitPassword(user);
  await expectSignedIn(user);
  await openSettings(user, "security");
  await expect(user.getByText("Off", { exact: true })).toBeVisible();
  await user.context().close();
});
