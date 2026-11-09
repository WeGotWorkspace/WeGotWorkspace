// Tasks sync matrix (live app). Two parts, each case with its own lists and
// tasks (named after the case id):
//
// 1. Actions × tab setup × connectivity. Tab A does the action in the UI.
//    After the reconnect, the server holds the change, every tab mirrors the
//    server as its own user sees it (cache fields, "All Tasks" view, sidebar),
//    and that still holds after a hard refresh of every tab. Each case keeps a
//    bystander task on a second list, which no action may lose. Where a due
//    date changes, every tab's Calendar week shows it in the right place (all
//    day, at a time, or not at all).
//    Tabs:  one · same (two tabs of one browser, one cache) · diff (the owner
//           and a teammate the case's lists are shared with, two caches).
//    Net:   on · off (one tab) · both · aOff (actor offline) · bOff (other tab offline).
//    Not every action runs every setup (`Nets` below): an edit of one field
//    goes through the same queued update as a rename, so it runs where the
//    field can get lost (queued offline, or arriving at the other user), and
//    sharing only means something with a second user.
//
// 2. Cases of their own: sharing (access revoked or made read-only while the
//    sharee has queued edits, a read-only sharee), a list deleted while
//    another tab or the teammate edits one of its tasks offline, the rescue
//    of a task the teammate adds or edits offline in a list that is made
//    read-only, deleted or no longer shared before it lands (#1825), and inbound
//    (#1565): changes made elsewhere (through the REST API, as a phone or a
//    CalDAV client would) against the changes token, the full-list fallback,
//    queued writes that a re-list must keep, the conflict check, list deletes.
//
// A write is held in the queue while the tab stays online by failing its
// request at the network (`holdRequests`), which is what a flaky connection
// does. Run one case with --grep "title · same · aOff".
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Route,
} from "@playwright/test";
import {
  api,
  calendarSpot,
  cleanUpCase,
  conflictDialog,
  converge,
  createList,
  createTask,
  deleteList,
  deleteTask,
  ensureTasksTeam,
  openTasksTab,
  openUser,
  OWNER,
  patchTask,
  POLL_MS,
  readAllNotifications,
  serverState,
  serverTask,
  setStoredToken,
  setTabOffline,
  shareList,
  showAllTasks,
  sleep,
  tabCache,
  TASKS_TEAM,
  TEAMMATE,
  waitForTasks,
  type CalendarSpot,
  type Rights,
  type ServerState,
  type Tab,
} from "./helpers/tasks-matrix";

type Tabs = "one" | "same" | "diff";
type Net = "on" | "off" | "both" | "aOff" | "bOff";
type Nets = Partial<Record<Tabs, Net[]>>;

/** Every setup: the actions that change what a list holds. */
const FULL: Nets = {
  one: ["on", "off"],
  same: ["on", "both", "aOff", "bOff"],
  diff: ["on", "both", "aOff", "bOff"],
};
/** One field of a task or list: queued offline, and arriving at the other user live and late. */
const FIELD: Nets = { one: ["off"], diff: ["on", "aOff"] };
/** Two writes in one go: only where a queue can reorder them (actor offline). */
const COMPOUND: Nets = { one: ["off"], same: ["aOff"], diff: ["aOff"] };
/** A new list is the owner's alone: the teammate only has to not get it. */
const NEW_LIST: Nets = { one: ["on", "off"], same: FULL.same, diff: ["on"] };
/** Sharing needs a connection on the owner's side; the teammate may be offline. */
const SHARE: Nets = { diff: ["on", "bOff"] };

/** Long enough for one poll in every tab plus a re-list. */
const MIRROR_MS = 2 * POLL_MS + 15_000;

/** Letters only, so a case id never matches a seeded list or task name. */
function caseId(): string {
  return Array.from({ length: 6 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26)),
  ).join("");
}

/** A local date `days` from today, YYYY-MM-DD. */
function isoDay(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Two due dates a week apart, so each is in a Calendar week of its own. */
const D1 = isoDay(7);
const D2 = isoDay(14);
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
/**
 * All day off gives the due 09:00 with no time zone: the pane saves floating time
 * on purpose (docs/architecture/tasks.md, Known limitations).
 */
const D1_AT_9 = `${D1}T09:00 floating`;
const ALERT_15M = {
  "@type": "Alert",
  action: "display",
  trigger: { "@type": "OffsetTrigger", offset: "-PT15M", relativeTo: "end" },
};

type Fixture = {
  id: string;
  /** The case's list ("M <id>") and its id. */
  listA: string;
  listAId: string;
  /** The second list ("M <id> b"): a move target, and home of the bystander task. */
  listB: string;
  listBId: string;
  /** The task the action works on ("T <id>"), when seeded. */
  task: string;
  taskId: string;
  /** The colour the list-colour action picked. */
  color?: string;
};

type Seed = {
  /** Fields for task T, or null for no T. */
  task?: Record<string, unknown> | null;
  /** With a teammate tab: how list A is shared with them (list B always is, to write). */
  shareA?: Rights | null;
  teammate?: boolean;
};

async function seed(id: string, { task = {}, shareA = "write", teammate = false }: Seed) {
  const listA = `M ${id}`;
  const listB = `M ${id} b`;
  const listAId = await createList(listA);
  const listBId = await createList(listB);
  await createTask(listBId, `B ${id}`);
  const title = `T ${id}`;
  const taskId = task ? (await createTask(listAId, title, task)).id : "";
  if (teammate) {
    await shareList(listBId, TEAMMATE, "write");
    if (shareA) await shareList(listAId, TEAMMATE, shareA);
  }
  const f: Fixture = { id, listA, listAId, listB, listBId, task: title, taskId };
  return f;
}

// --- the actor's steps -------------------------------------------------------------------------

function row(tab: Tab, title: string) {
  return tab.locator(".tasks-list-row").filter({
    has: tab.locator(".list-item__title").getByText(title, { exact: true }),
  });
}

/** Opens the task in the detail pane; every change there saves itself. */
async function openTask(tab: Tab, title: string): Promise<Locator> {
  await row(tab, title).locator(".list-item__button").click();
  const detail = tab.locator(".tasks-detail-view");
  await expect(detail.getByRole("textbox", { name: "Task name" })).toHaveValue(title, {
    timeout: 10_000,
  });
  return detail;
}

/** Quick add: the title only, into the list whose view is open. */
async function quickAdd(tab: Tab, title: string) {
  const field = tab.getByRole("textbox", { name: "Quick add task" });
  await field.fill(title);
  await field.press("Enter");
  await row(tab, title).waitFor({ timeout: 15_000 });
}

function sidebarList(tab: Tab, name: string) {
  return tab
    .getByRole("region", { name: /My lists|Shared with me/ })
    .getByRole("listitem")
    .filter({ has: tab.getByRole("button", { name, exact: true }) });
}

async function pickOption(tab: Tab, combobox: Locator, name: string) {
  await combobox.click();
  await tab.getByRole("option", { name, exact: true }).click();
  await sleep(200);
}

async function pick(tab: Tab, scope: Locator, label: string, name: string) {
  await pickOption(tab, scope.getByRole("combobox", { name: label }), name);
}

/** Quick add in the list's own view; a due date is then set on the open task. */
async function addTask(tab: Tab, title: string, list: string, dues: Due[] = []) {
  await sidebarList(tab, list).getByRole("button", { name: list, exact: true }).click();
  await sleep(300);
  await quickAdd(tab, title);
  if (dues.length) {
    const detail = await openTask(tab, title);
    for (const due of dues) await setDue(tab, detail, due);
  }
  await showAllTasks(tab);
  await sleep(2_000);
}

/** Delete from the open task's action bar (the confirm follows). */
async function deleteFromDetail(tab: Tab, title: string) {
  await openTask(tab, title);
  await tab
    .locator(".workspace-detail-pane .action-bar")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
}

/** A day from the picker, no due, or the All day switch off (09:00) / on. */
type Due = { date: string } | "none" | "timed" | "allDay";
/** Alarm rows: `change` and `remove` act on Alarm 1; `add` fills the empty last row. */
type Remind = { add?: string[]; change?: string; remove?: boolean };
type Edit = {
  title?: string;
  list?: string;
  description?: string;
  priority?: "None" | "High" | "Medium" | "Low";
  status?: "Needs action" | "In progress" | "Completed";
  due?: Due;
  remind?: Remind;
};

/** The day button for `iso` in the open date picker, paging ahead a month at most twice. */
async function pickDay(tab: Tab, popover: Locator, iso: string) {
  const date = new Date(`${iso}T12:00:00`);
  const month = date.toLocaleString("en-US", { month: "long" });
  const day = date.getDate();
  const suffix = [11, 12, 13].includes(day % 100)
    ? "th"
    : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th");
  const name = new RegExp(`${month} ${day}${suffix}, ${date.getFullYear()}`);
  for (let page = 0; page < 3; page += 1) {
    const button = popover.getByRole("button", { name });
    if ((await button.count()) > 0) {
      await button.first().click();
      return;
    }
    await popover.getByRole("button", { name: /next month/i }).click();
  }
  throw new Error(`no day ${iso} in the date picker`);
}

/** Sets the due in the open task. Each pick saves at once. */
async function setDue(tab: Tab, detail: Locator, due: Due) {
  if (due === "timed" || due === "allDay") {
    // A due day shows the All day switch: off gives 09:00, on a date again.
    const allDay = detail.getByRole("switch", { name: "All day" });
    if ((await allDay.isChecked()) !== (due === "allDay")) await allDay.click();
    await sleep(200);
    return;
  }
  await detail.getByRole("button", { name: /^Due date:/ }).click();
  const popover = tab.locator(".tasks-field__due-popover");
  await popover.waitFor({ timeout: 10_000 });
  // Picking a day or clearing the due closes the picker.
  if (due === "none") await popover.getByRole("button", { name: "No due date" }).click();
  else await pickDay(tab, popover, due.date);
  await popover.waitFor({ state: "detached", timeout: 5_000 });
  await sleep(200);
}

/** Alarms are dropdowns "Alarm 1", "Alarm 2", …; the last one is empty, for the next. */
async function setReminders(tab: Tab, detail: Locator, remind: Remind) {
  const alarms = detail.getByRole("combobox", { name: /^Alarm \d+$/ });
  if (remind.change) await pickOption(tab, alarms.first(), remind.change);
  if (remind.remove) await pickOption(tab, alarms.first(), "None");
  for (const offset of remind.add ?? []) await pickOption(tab, alarms.last(), offset);
}

/** Changes the open task in the detail pane. Typing saves after a pause, a pick at once. */
async function editTask(tab: Tab, title: string, change: Edit) {
  const detail = await openTask(tab, title);
  if (change.title) await detail.getByRole("textbox", { name: "Task name" }).fill(change.title);
  if (change.description !== undefined) {
    await detail.getByRole("textbox", { name: "Notes" }).fill(change.description);
  }
  if (change.list) await pick(tab, detail, "List", change.list);
  if (change.status) await pick(tab, detail, "Status", change.status);
  if (change.priority) await pick(tab, detail, "Priority", change.priority);
  if (change.due) await setDue(tab, detail, change.due);
  if (change.remind) await setReminders(tab, detail, change.remind);
  await sleep(2_500);
}

async function setShowCompleted(tab: Tab, on: boolean) {
  const button = tab.getByRole("button", { name: on ? "Show completed" : "Hide completed" });
  if (await button.count()) await button.click();
  await sleep(300);
}

async function openListDialog(tab: Tab, name: string) {
  await sidebarList(tab, name).getByRole("button", { name: "Edit list" }).click();
  const dialog = tab.getByRole("dialog", { name: "Edit list" });
  await dialog.waitFor({ timeout: 10_000 });
  return dialog;
}

async function saveListDialog(dialog: Locator) {
  await dialog.getByRole("button", { name: "Save" }).click();
  await dialog.waitFor({ state: "detached", timeout: 10_000 });
  await sleep(2_500);
}

/** Share list A from its dialog: search, pick, and with `edit` raise it to "Can edit". */
async function grantAccess(
  tab: Tab,
  f: Fixture,
  query: string,
  option: string | RegExp,
  edit: boolean,
) {
  const dialog = await openListDialog(tab, f.listA);
  await dialog.getByPlaceholder("Add people or groups…").fill(query);
  await tab.getByRole("option").filter({ hasText: option }).first().click();
  const access = dialog.getByRole("combobox", { name: "Can view" });
  await access.waitFor({ timeout: 10_000 });
  if (edit) {
    await pickOption(tab, access, "Can edit");
    await dialog.getByRole("combobox", { name: "Can edit" }).waitFor({ timeout: 10_000 });
  }
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await dialog.waitFor({ state: "detached", timeout: 10_000 });
  await sleep(1_000);
}

const titled = (s: ServerState, title: string) => s.tasks.find((t) => t.title === title);
const taskT = (s: ServerState, f: Fixture) => s.tasks.find((t) => t.id === f.taskId);
const listOf = (s: ServerState, id: string) => s.lists.find((l) => l.id === id);
const hasList = (s: ServerState | null, name: string) => !!s?.lists.some((l) => l.name === name);

type ActionDef = {
  nets: Nets;
  /** Fields task T is seeded with; null for no T. */
  task?: Record<string, unknown> | null;
  /** How list A is shared with the teammate in a `diff` case. */
  shareA?: Rights | null;
  run: (tab: Tab, f: Fixture) => Promise<void>;
  /** The server once the action landed: the owner's view, and the teammate's in `diff`. */
  landed: (s: ServerState, f: Fixture, mate: ServerState | null) => boolean;
  /** Where the task's due shows in the Calendar afterwards, in every tab. */
  calendar?: (f: Fixture) => Array<{ date: string; spot: CalendarSpot; title?: string }>;
};

const ACTIONS = {
  // --- task ---
  create: {
    nets: FULL,
    run: (tab, f) => addTask(tab, `N ${f.id}`, f.listA),
    landed: (s, f) => titled(s, `N ${f.id}`)?.listId === f.listAId,
  },
  title: {
    nets: FULL,
    run: (tab, f) => editTask(tab, f.task, { title: `${f.task} v2` }),
    landed: (s, f) => taskT(s, f)?.title === `${f.task} v2`,
  },
  delete: {
    nets: FULL,
    async run(tab, f) {
      await deleteFromDetail(tab, f.task);
      await tab.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
      // The delete waits out its undo delay (2.5 s) before it is sent or queued.
      await sleep(5_000);
    },
    landed: (s, f) => !taskT(s, f),
  },
  move: {
    nets: FULL,
    run: (tab, f) => editTask(tab, f.task, { list: f.listB }),
    landed: (s, f) => taskT(s, f)?.listId === f.listBId,
  },
  // Several fields in one save.
  edit: {
    nets: COMPOUND,
    run: (tab, f) =>
      editTask(tab, f.task, {
        title: `${f.task} v2`,
        description: "first note",
        priority: "High",
        due: { date: D1 },
        remind: { add: ["15 minutes before"] },
      }),
    landed: (s, f) => {
      const t = taskT(s, f);
      return (
        t?.title === `${f.task} v2` &&
        t.description === "first note" &&
        t.priority === 1 &&
        t.due === D1 &&
        t.alerts.join() === "-PT15M end"
      );
    },
    calendar: (f) => [{ date: D1, spot: "all-day", title: `${f.task} v2` }],
  },
  descChange: {
    nets: FIELD,
    task: { description: "note one" },
    run: (tab, f) => editTask(tab, f.task, { description: "note two" }),
    landed: (s, f) => taskT(s, f)?.description === "note two",
  },
  descRemove: {
    nets: FIELD,
    task: { description: "note one" },
    run: (tab, f) => editTask(tab, f.task, { description: "" }),
    landed: (s, f) => taskT(s, f)?.description === "",
  },
  priorityAdd: {
    nets: FIELD,
    run: (tab, f) => editTask(tab, f.task, { priority: "High" }),
    landed: (s, f) => taskT(s, f)?.priority === 1,
  },
  priorityChange: {
    nets: FIELD,
    task: { priority: 5 },
    run: (tab, f) => editTask(tab, f.task, { priority: "Low" }),
    landed: (s, f) => taskT(s, f)?.priority === 9,
  },
  priorityRemove: {
    nets: FIELD,
    task: { priority: 1 },
    run: (tab, f) => editTask(tab, f.task, { priority: "None" }),
    landed: (s, f) => taskT(s, f)?.priority === 0,
  },
  statusForward: {
    nets: FIELD,
    async run(tab, f) {
      await editTask(tab, f.task, { status: "In progress" });
      await row(tab, f.task).getByRole("checkbox", { name: "Mark complete" }).click();
      await sleep(2_500);
    },
    landed: (s, f) => taskT(s, f)?.status === "completed",
  },
  // The done box ticked while the typed title's save is still on its way: both land,
  // and the tick does not take the title back.
  tickDuringAutosave: {
    nets: { one: ["on", "off"] },
    async run(tab, f) {
      const detail = await openTask(tab, f.task);
      const url = `**/api/v1/tasks/items/${f.taskId}`;
      let sent = () => {};
      const inFlight = new Promise<void>((resolve) => (sent = resolve));
      const slow = async (route: Route) => {
        sent();
        await sleep(3_000);
        await route.fallback();
      };
      await tab.route(url, slow);
      await detail.getByRole("textbox", { name: "Task name" }).fill(`${f.task} v2`);
      // Offline nothing is sent: the tick then queues behind the queued title.
      await Promise.race([inFlight, sleep(4_000)]);
      await detail.getByRole("checkbox", { name: "Mark complete" }).click();
      await sleep(4_000);
      await tab.unroute(url, slow);
    },
    landed: (s, f) => {
      const t = taskT(s, f);
      return t?.title === `${f.task} v2` && t.status === "completed";
    },
  },
  statusBack: {
    nets: FIELD,
    task: { workflowStatus: "completed" },
    async run(tab, f) {
      await setShowCompleted(tab, true);
      await editTask(tab, f.task, { status: "In progress" });
      await editTask(tab, f.task, { status: "Needs action" });
      await setShowCompleted(tab, false);
    },
    landed: (s, f) => taskT(s, f)?.status === "needs-action",
  },
  remindOne: {
    nets: FIELD,
    task: { due: D1, showWithoutTime: true },
    run: (tab, f) => editTask(tab, f.task, { remind: { add: ["15 minutes before"] } }),
    landed: (s, f) => taskT(s, f)?.alerts.join() === "-PT15M end",
  },
  remindSeveral: {
    nets: FIELD,
    task: { due: D1, showWithoutTime: true },
    run: (tab, f) =>
      editTask(tab, f.task, { remind: { add: ["15 minutes before", "1 hour before"] } }),
    landed: (s, f) => taskT(s, f)?.alerts.join() === "-PT15M end,-PT1H end",
  },
  remindChange: {
    nets: FIELD,
    task: { due: D1, showWithoutTime: true, alerts: { a1: ALERT_15M } },
    run: (tab, f) => editTask(tab, f.task, { remind: { change: "1 hour before" } }),
    landed: (s, f) => taskT(s, f)?.alerts.join() === "-PT1H end",
  },
  remindDelete: {
    nets: FIELD,
    task: { due: D1, showWithoutTime: true, alerts: { a1: ALERT_15M } },
    run: (tab, f) => editTask(tab, f.task, { remind: { remove: true } }),
    landed: (s, f) => taskT(s, f)?.alerts.length === 0,
  },
  // One alarm of two removed: the other one stays.
  remindDeleteOne: {
    nets: FIELD,
    task: {
      due: D1,
      showWithoutTime: true,
      alerts: {
        a1: ALERT_15M,
        a2: { ...ALERT_15M, trigger: { ...ALERT_15M.trigger, offset: "-PT1H" } },
      },
    },
    run: (tab, f) => editTask(tab, f.task, { remind: { remove: true } }),
    landed: (s, f) => taskT(s, f)?.alerts.join() === "-PT1H end",
  },
  dueAdd: {
    nets: FIELD,
    run: (tab, f) => editTask(tab, f.task, { due: { date: D1 } }),
    landed: (s, f) => taskT(s, f)?.due === D1,
    calendar: () => [{ date: D1, spot: "all-day" }],
  },
  dueChange: {
    nets: FIELD,
    task: { due: D1, showWithoutTime: true },
    run: (tab, f) => editTask(tab, f.task, { due: { date: D2 } }),
    landed: (s, f) => taskT(s, f)?.due === D2,
    calendar: () => [
      { date: D2, spot: "all-day" },
      { date: D1, spot: "none" },
    ],
  },
  dueRemove: {
    nets: FIELD,
    task: { due: D1, showWithoutTime: true },
    run: (tab, f) => editTask(tab, f.task, { due: "none" }),
    landed: (s, f) => taskT(s, f)?.due === "",
    calendar: () => [{ date: D1, spot: "none" }],
  },
  // All day → at a time.
  dueTimed: {
    nets: FIELD,
    task: { due: D1, showWithoutTime: true },
    run: (tab, f) => editTask(tab, f.task, { due: "timed" }),
    landed: (s, f) => taskT(s, f)?.due === D1_AT_9,
    calendar: () => [{ date: D1, spot: "timed" }],
  },
  // At a time → all day.
  dueAllDay: {
    nets: FIELD,
    task: { due: `${D1}T09:00:00`, showWithoutTime: false, timeZone: ZONE },
    run: (tab, f) => editTask(tab, f.task, { due: "allDay" }),
    landed: (s, f) => taskT(s, f)?.due === D1,
    calendar: () => [{ date: D1, spot: "all-day" }],
  },
  // --- list ---
  listCreate: {
    nets: NEW_LIST,
    async run(tab, f) {
      await tab.getByRole("button", { name: "More create options" }).click();
      await tab.getByRole("menuitem", { name: "Create list" }).click();
      const dialog = tab.getByRole("dialog", { name: "Create list" });
      await dialog.getByRole("textbox", { name: "List name" }).fill(`M ${f.id} new`);
      await dialog.getByRole("button", { name: "Create" }).click();
      await dialog.waitFor({ state: "detached", timeout: 10_000 });
      await sleep(2_500);
    },
    landed: (s, f, mate) => hasList(s, `M ${f.id} new`) && !hasList(mate, `M ${f.id} new`),
  },
  listRename: {
    nets: FULL,
    async run(tab, f) {
      const dialog = await openListDialog(tab, f.listA);
      await dialog.getByRole("textbox", { name: "List name" }).fill(`M ${f.id} renamed`);
      await saveListDialog(dialog);
    },
    landed: (s, f, mate) =>
      listOf(s, f.listAId)?.name === `M ${f.id} renamed` &&
      (!mate || hasList(mate, `M ${f.id} renamed`)),
  },
  listColor: {
    nets: FIELD,
    async run(tab, f) {
      const dialog = await openListDialog(tab, f.listA);
      await dialog.getByRole("button", { name: "Color" }).click();
      // A list without a colour shows one derived from its id: pick another.
      const swatch = tab.getByRole("radio", { checked: false }).first();
      f.color = (await swatch.getAttribute("aria-label")) ?? "";
      await swatch.click();
      await sleep(200);
      if (await tab.getByRole("radiogroup").count()) await tab.keyboard.press("Escape");
      await saveListDialog(dialog);
    },
    landed: (s, f, mate) =>
      !!f.color &&
      listOf(s, f.listAId)?.color === f.color.toLowerCase() &&
      (!mate || mate.lists.find((l) => l.name === f.listA)?.color === f.color.toLowerCase()),
  },
  // List A still holds task T: its tasks go with it.
  listDelete: {
    nets: FULL,
    async run(tab, f) {
      const dialog = await openListDialog(tab, f.listA);
      await dialog.getByRole("button", { name: "Delete list" }).click();
      await tab.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
      await sleep(3_000);
    },
    landed: (s, f, mate) => !listOf(s, f.listAId) && !taskT(s, f) && !hasList(mate, f.listA),
  },
  // --- sharing (the owner's list A, seen by the teammate) ---
  shareMember: {
    nets: SHARE,
    shareA: null,
    run: (tab, f) => grantAccess(tab, f, TEAMMATE, new RegExp(TEAMMATE, "i"), true),
    landed: (s, f, mate) =>
      listOf(s, f.listAId)?.shares.join() === `${TEAMMATE} write` && hasList(mate, f.listA),
  },
  shareGroup: {
    nets: SHARE,
    shareA: null,
    run: (tab, f) => grantAccess(tab, f, "E2E Tasks", TASKS_TEAM.name, false),
    landed: (s, f, mate) =>
      listOf(s, f.listAId)?.shares.join() === `groups/${TASKS_TEAM.slug} read` &&
      hasList(mate, f.listA),
  },
  revoke: {
    nets: SHARE,
    async run(tab, f) {
      const dialog = await openListDialog(tab, f.listA);
      await dialog.getByRole("button", { name: "Remove access" }).first().click();
      await tab.getByRole("alertdialog").getByRole("button", { name: "Continue" }).click();
      await expect(dialog.getByRole("button", { name: "Remove access" })).toHaveCount(0, {
        timeout: 10_000,
      });
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "detached", timeout: 10_000 });
      await sleep(1_000);
    },
    landed: (s, f, mate) => listOf(s, f.listAId)?.shares.length === 0 && !hasList(mate, f.listA),
  },
  // --- compound ---
  // A move and a rename saved together (the dialog sends a move, then a patch).
  renameMove: {
    nets: COMPOUND,
    run: (tab, f) => editTask(tab, f.task, { title: `${f.task} v2`, list: f.listB }),
    landed: (s, f) => titled(s, `${f.task} v2`)?.listId === f.listBId,
  },
  // A new task, renamed before it reached the server.
  createRename: {
    nets: COMPOUND,
    async run(tab, f) {
      await addTask(tab, `N ${f.id}`, f.listA);
      await editTask(tab, `N ${f.id}`, { title: `N ${f.id} v2` });
    },
    landed: (s, f) => titled(s, `N ${f.id} v2`)?.listId === f.listAId && !titled(s, `N ${f.id}`),
  },
  // A new task with a timed due, moved before it reached the server: the queued
  // move rides on the server id and must keep the due's time, still floating
  // (the pane saves no time zone; a zone that appears means the move added one).
  createMove: {
    nets: COMPOUND,
    async run(tab, f) {
      await addTask(tab, `N ${f.id}`, f.listA, [{ date: D1 }, "timed"]);
      await editTask(tab, `N ${f.id}`, { list: f.listB });
    },
    landed: (s, f) => {
      const t = titled(s, `N ${f.id}`);
      return (
        t?.listId === f.listBId &&
        t.due === D1_AT_9 &&
        s.tasks.every((x) => x.title !== `N ${f.id}` || x.listId !== f.listAId)
      );
    },
    calendar: (f) => [{ date: D1, spot: "timed", title: `N ${f.id}` }],
  },
  // The same with an all-day due.
  createMoveAllDay: {
    nets: COMPOUND,
    async run(tab, f) {
      await addTask(tab, `N ${f.id}`, f.listA, [{ date: D1 }]);
      await editTask(tab, `N ${f.id}`, { list: f.listB });
    },
    landed: (s, f) => {
      const t = titled(s, `N ${f.id}`);
      return (
        t?.listId === f.listBId &&
        t.due === D1 &&
        s.tasks.every((x) => x.title !== `N ${f.id}` || x.listId !== f.listAId)
      );
    },
    calendar: (f) => [{ date: D1, spot: "all-day", title: `N ${f.id}` }],
  },
} satisfies Record<string, ActionDef>;
type Action = keyof typeof ACTIONS;

// --- one case ----------------------------------------------------------------------------------

type Session = { tabs: Tab[]; contexts: BrowserContext[]; events: string[] };

async function openTabs(browser: Browser, tabs: Tabs): Promise<Session> {
  const events: string[] = [];
  const contexts: BrowserContext[] = [await openUser(browser, OWNER)];
  const a = await openTasksTab(contexts[0]!, "A", events);
  const all = [a];
  if (tabs === "same") all.push(await openTasksTab(contexts[0]!, "A2", events));
  if (tabs === "diff") {
    contexts.push(await openUser(browser, TEAMMATE));
    all.push(await openTasksTab(contexts[1]!, "B", events, TEAMMATE));
  }
  return { tabs: all, contexts, events };
}

async function closeTabs(session: Session | null) {
  if (!session) return;
  // Offline, a "Failed to fetch" is expected: report page errors, do not fail on them.
  for (const event of session.events) {
    test.info().annotations.push({ type: "page error", description: event });
  }
  for (const context of session.contexts) await context.close().catch(() => undefined);
}

/** Every tab holds the case before the action, with what the tabs logged if not. */
async function expectLoaded(session: Session, id: string) {
  const open = await converge(session.tabs, id, 30_000);
  let log = "";
  for (const tab of session.tabs.filter((t) => open[t.tag])) {
    const own = session.events.filter((event) => event.startsWith(`${tab.tag} `)).slice(-10);
    const screen = (
      await tab
        .locator("main, body")
        .first()
        .innerText()
        .catch(() => "")
    )
      .replace(/\s+/g, " ")
      .slice(0, 240);
    log += `\n${tab.tag} shows: ${screen}${own.length ? `\n${own.join("\n")}` : ""}`;
  }
  expect(open, `every tab loads the case first${log}`).toEqual({});
}

async function hardRefresh(tabs: Tab[]) {
  for (const tab of tabs) {
    await tab.reload();
    await waitForTasks(tab);
  }
  await sleep(2_000);
}

/** The outboxes of the tabs, appended to a failed check. */
async function withOutboxes(tabs: Tab[], id: string, error: unknown): Promise<never> {
  let message = String(error);
  for (const tab of tabs) {
    const queued = (await tabCache(tab, id).catch(() => null))?.outbox ?? [];
    if (queued.length) message += `\n${tab.tag} outbox: ${queued}`;
  }
  const server = await serverState(id).catch(() => null);
  if (server) {
    const task = server.tasks
      .filter((t) => /^[TN] /.test(t.title))
      .map(({ etag: _etag, ...t }) => t);
    message += `\nserver: lists ${JSON.stringify(server.lists)}\nserver: task ${JSON.stringify(task)}`;
  }
  throw new Error(message);
}

async function expectLanded(
  all: Tab[],
  id: string,
  landed: (s: ServerState, mate: ServerState | null) => boolean,
) {
  const teammate = all.some((tab) => tab.user === TEAMMATE);
  await expect
    .poll(
      async () => landed(await serverState(id), teammate ? await serverState(id, TEAMMATE) : null),
      { message: "the server holds the action", timeout: 30_000, intervals: [2_500] },
    )
    .toBe(true)
    .catch((error: unknown) => withOutboxes(all, id, error));
}

async function expectCalendar(all: Tab[], f: Fixture, def: ActionDef) {
  for (const want of def.calendar?.(f) ?? []) {
    for (const tab of all) {
      const spot = await calendarSpot(tab, want.date, want.title ?? f.task, want.spot);
      expect(spot, `${tab.tag}: the Calendar week of ${want.date}`).toBe(want.spot);
    }
  }
}

async function runCase(browser: Browser, action: Action, tabs: Tabs, net: Net, id: string) {
  const def: ActionDef = ACTIONS[action];
  let session: Session | null = null;
  try {
    const f = await seed(id, {
      task: def.task === undefined ? {} : def.task,
      shareA: def.shareA === undefined ? "write" : def.shareA,
      teammate: tabs === "diff",
    });
    session = await openTabs(browser, tabs);
    const all = session.tabs;
    const [a, b] = all;
    await expectLoaded(session, id);

    const offline = { on: [], off: [a!], both: all, aOff: [a!], bOff: b ? [b] : [] }[net];
    for (const tab of offline) await setTabOffline(tab, true);
    await sleep(1_000);
    await a!.bringToFront();
    await showAllTasks(a!);
    await def.run(a!, f);
    await sleep(1_000);
    for (const tab of offline) await setTabOffline(tab, false);

    await expectLanded(all, id, (s, mate) => def.landed(s, f, mate));
    expect(await converge(all, id, MIRROR_MS), "every tab mirrors the server").toEqual({});

    await hardRefresh(all);
    expect(await converge(all, id, 15_000), "still in sync after a hard refresh").toEqual({});
    await expectCalendar(all, f, def);
  } finally {
    await closeTabs(session);
    await cleanUpCase(id);
  }
}

// --- inbound helpers ---------------------------------------------------------------------------

/** Fail the matching requests at the network, so the app queues the write. */
async function holdRequests(
  tab: Pick<BrowserContext, "route" | "unroute">,
  method: string,
  path: string,
): Promise<() => Promise<void>> {
  const url = `**/api/v1${path}`;
  const handler = async (route: Route) => {
    // The app tunnels PATCH, PUT and DELETE through POST (`X-HTTP-Method-Override`).
    const request = route.request();
    const sent = (await request.headerValue("x-http-method-override")) ?? request.method();
    if (sent === method) await route.abort("internetdisconnected");
    else await route.fallback();
  };
  await tab.route(url, handler);
  return () => tab.unroute(url, handler);
}

/** A short drop of the connection: the reconnect flushes the queue, then pulls. */
async function reconnect(tab: Tab) {
  await setTabOffline(tab, true);
  await sleep(1_500);
  await setTabOffline(tab, false);
}

/**
 * Fails every `GET tasks/tasklists/changes` until released, so no pull can write a token back over
 * one injected meanwhile. Requests already in flight get a moment to settle first. The next pull
 * after the release reads whatever token is stored then.
 */
async function blockChanges(tab: Tab) {
  const url = /\/tasks\/tasklists\/changes/;
  const handler = (route: Route) => route.abort("failed");
  await tab.route(url, handler);
  await sleep(3_000);
  return () => tab.unroute(url, handler);
}

/** `GET tasks/tasklists/changes` calls since now, split into token pulls and full lists. */
function watchChanges(tabs: Tab[]) {
  const calls = {
    since: 0,
    full: 0,
    /** The `since` of each finished changes request, in order; `null` for a full list. */
    sinces: [] as (string | null)[],
    relisted: new Set<string>(),
  };
  for (const tab of tabs) {
    // `requestfinished`, not `request`: a request `blockChanges` aborts never finishes and applies nothing.
    tab.on("requestfinished", (request) => {
      const url = new URL(request.url());
      if (url.pathname.endsWith("/tasks/tasklists/changes")) {
        const full = !url.searchParams.has("since");
        calls.sinces.push(url.searchParams.get("since"));
        if (full) calls.full += 1;
        else calls.since += 1;
      }
      if (url.pathname.endsWith("/tasks/items") && url.searchParams.has("taskListId")) {
        calls.relisted.add(url.searchParams.get("taskListId")!);
      }
    });
  }
  return calls;
}

function pollCache<T>(
  tab: Tab,
  id: string,
  read: (c: Awaited<ReturnType<typeof tabCache>>) => T,
  message: string,
) {
  return expect.poll(async () => read(await tabCache(tab, id)), {
    message,
    timeout: 2 * POLL_MS + 10_000,
    intervals: [2_000],
  });
}

async function expectNoConflict(tab: Tab) {
  await sleep(2_000);
  await expect(conflictDialog(tab), "no sync conflict").toHaveCount(0);
}

/** Inject a queued edit with no recorded base, as one written before bases were kept. */
async function queueEditWithoutBase(tab: Tab, taskId: string, title: string) {
  await tab.evaluate(
    async ({ taskId, title }) => {
      const user = localStorage.getItem("wgw.offline.tasks.username") ?? "";
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(`wgw-offline-${user.trim().toLowerCase()}`);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["outbox", "tasks_items"], "readwrite");
        tx.objectStore("outbox").put({
          id: crypto.randomUUID(),
          domain: "tasks",
          op: "update",
          payload: JSON.stringify({ taskId, patch: { title } }),
          createdAt: Date.now(),
          retries: 0,
        });
        const items = tx.objectStore("tasks_items");
        const get = items.get(taskId);
        get.onsuccess = () => {
          const row = get.result as { data: string; pendingSync: boolean };
          const task = JSON.parse(row.data) as Record<string, unknown>;
          items.put({ ...row, data: JSON.stringify({ ...task, title }), pendingSync: true });
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { taskId, title },
  );
}

/** One tab on a fresh case: list A with tasks "T1..Tn <id>", list B with the bystander. */
async function inboundCase(browser: Browser, id: string, taskCount: number) {
  const f = await seed(id, { task: null });
  const tasks: string[] = [];
  for (let i = 1; i <= taskCount; i += 1) {
    tasks.push((await createTask(f.listAId, `T${i} ${id}`)).id);
  }
  const session = await openTabs(browser, "one");
  const tab = session.tabs[0]!;
  await expectLoaded(session, id);
  return { f, tasks, session, tab };
}

// --- known bugs --------------------------------------------------------------------------------

/**
 * Open bugs this matrix found, by action, as issue numbers. Such a case is
 * marked as expected to fail, so the run stays green and a fix shows up as
 * "expected to fail, but passed": then drop the entry. None are open now.
 */
const BUGS: Partial<Record<Action, number[]>> = {};

function knownBugs(action: Action): number[] {
  return BUGS[action] ?? [];
}

function expectKnownBugs(bugs: number[]) {
  if (bugs.length === 0) return;
  const issues = bugs.map((bug) => `#${bug}`).join(", ");
  for (const bug of bugs) test.info().annotations.push({ type: "issue", description: `#${bug}` });
  test.fail(true, `known bug ${issues}`);
}

// --- the matrix --------------------------------------------------------------------------------

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

test.beforeAll(async ({ browser }) => {
  await ensureTasksTeam();
  for (const user of [OWNER, TEAMMATE]) await readAllNotifications(user);
  // A cold Vite dev server compiles each module on first request and may reload
  // the page; pay for that once, before the first case.
  const context = await openUser(browser, OWNER);
  try {
    const tab = await openTasksTab(context, "warm-up", []);
    await tab.getByRole("button", { name: "More create options" }).click();
    await tab.keyboard.press("Escape");
    await tab.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  } finally {
    await context.close().catch(() => undefined);
  }
});

for (const action of Object.keys(ACTIONS) as Action[]) {
  const nets: Nets = ACTIONS[action].nets;
  for (const tabs of Object.keys(nets) as Tabs[]) {
    for (const net of nets[tabs] ?? []) {
      test(`${action} · ${tabs} · ${net}`, async ({ browser }) => {
        expectKnownBugs(knownBugs(action));
        await runCase(browser, action, tabs, net, caseId());
      });
    }
  }
}

// --- sharing and list deletes with a queued edit -----------------------------------------------

/** The second tab (the other tab, or the teammate) edits task T offline: one queued update. */
async function queueEditOffline(b: Tab, f: Fixture, title: string) {
  await setTabOffline(b, true);
  await sleep(1_000);
  await b.bringToFront();
  await showAllTasks(b);
  await editTask(b, f.task, { title });
  expect((await tabCache(b, f.id)).outbox, `${b.tag} queued the edit`).toEqual(["update"]);
}

/** The teammate's refused edit waits in the rescue dialog (#1825); these cases discard it. */
async function discardRefusedEdit(b: Tab) {
  const dialog = rescueDialog(b);
  await expect(dialog, "the refused edit asks where it goes").toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("button", { name: /^Discard/ }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

test.describe("sharing", () => {
  test("revoked while the teammate has a queued edit", async ({ browser }) => {
    const id = caseId();
    let session: Session | null = null;
    try {
      const f = await seed(id, { teammate: true });
      session = await openTabs(browser, "diff");
      const all = session.tabs;
      const [a, b] = all as [Tab, Tab];
      await expectLoaded(session, id);
      await queueEditOffline(b, f, `${f.task} mate`);

      await a.bringToFront();
      await ACTIONS.revoke.run(a, f);
      await setTabOffline(b, false);
      await discardRefusedEdit(b);

      // The teammate loses the list and its task; the edit does not land.
      await expectLanded(all, id, (_, mate) => !hasList(mate, f.listA));
      expect(await converge(all, id, MIRROR_MS), "every tab mirrors the server").toEqual({});
      expect((await serverTask(f.taskId))?.title, "the revoked edit did not land").toBe(f.task);
    } finally {
      await closeTabs(session);
      await cleanUpCase(id);
    }
  });

  test("made read-only while the teammate has a queued edit", async ({ browser }) => {
    const id = caseId();
    let session: Session | null = null;
    try {
      const f = await seed(id, { teammate: true });
      session = await openTabs(browser, "diff");
      const all = session.tabs;
      const b = all[1]!;
      await expectLoaded(session, id);
      await queueEditOffline(b, f, `${f.task} mate`);

      await shareList(f.listAId, TEAMMATE, "read");
      await setTabOffline(b, false);
      await discardRefusedEdit(b);

      expect(await converge(all, id, MIRROR_MS), "every tab mirrors the server").toEqual({});
      expect((await serverTask(f.taskId))?.title, "the read-only edit did not land").toBe(f.task);
      expect(
        (await serverState(id, TEAMMATE)).lists.find((l) => l.name === f.listA)?.writable,
      ).toBe(false);
    } finally {
      await closeTabs(session);
      await cleanUpCase(id);
    }
  });

  test("a read-only teammate cannot edit", async ({ browser }) => {
    const id = caseId();
    let session: Session | null = null;
    try {
      const f = await seed(id, { teammate: true, shareA: "read" });
      session = await openTabs(browser, "diff");
      const all = session.tabs;
      const b = all[1]!;
      await expectLoaded(session, id);
      await b.bringToFront();
      await showAllTasks(b);

      // The UI offers no write on the list.
      const target = row(b, f.task);
      await expect(target.getByRole("checkbox", { name: "Mark complete" })).toBeDisabled();
      // The open task is read-only: no typing, no picks, no complete or delete.
      const detail = await openTask(b, f.task);
      await expect(detail.getByRole("textbox", { name: "Task name" })).toHaveAttribute("readonly");
      await expect(detail.getByRole("textbox", { name: "Notes" })).toHaveAttribute("readonly");
      for (const name of ["List", "Status", "Priority"]) {
        await expect(detail.getByRole("combobox", { name })).toBeDisabled();
      }
      const bar = b.locator(".workspace-detail-pane .action-bar");
      await expect(bar.getByRole("button", { name: "Delete", exact: true })).toBeDisabled();
      // Quick add never lands in the read-only list: its view offers no field.
      // A view-only list's name carries its badge, so match the start only.
      await b
        .getByRole("button", { name: new RegExp(`^${f.listA}`) })
        .first()
        .click();
      await expect(b.getByRole("textbox", { name: "Quick add task" })).toBeDisabled();
      await showAllTasks(b);

      // The API refuses a write from them, too.
      const res = await patchTask(f.taskId, { title: `${f.task} mate` }, TEAMMATE);
      expect([403, 404], `PATCH as a read-only sharee: ${res.status}`).toContain(res.status);
      expect((await serverTask(f.taskId))?.title).toBe(f.task);
      expect(await converge(all, id, 15_000), "every tab mirrors the server").toEqual({});
    } finally {
      await closeTabs(session);
      await cleanUpCase(id);
    }
  });
});

test.describe("list delete with a queued edit", () => {
  for (const tabs of ["same", "diff"] as const) {
    const who = tabs === "same" ? "another tab" : "the teammate";
    test(`list delete · while ${who} edits one of its tasks offline`, async ({ browser }) => {
      const id = caseId();
      let session: Session | null = null;
      try {
        const f = await seed(id, { teammate: tabs === "diff" });
        session = await openTabs(browser, tabs);
        const all = session.tabs;
        const [a, b] = all as [Tab, Tab];
        await expectLoaded(session, id);
        await queueEditOffline(b, f, `${f.task} b`);

        await a.bringToFront();
        await showAllTasks(a);
        await ACTIONS.listDelete.run(a, f);
        await setTabOffline(b, false);
        if (tabs === "diff") await discardRefusedEdit(b);

        await expectLanded(all, id, (s, mate) => !listOf(s, f.listAId) && !hasList(mate, f.listA));
        expect(await converge(all, id, MIRROR_MS), "every tab mirrors the server").toEqual({});
        expect(await serverTask(f.taskId), "the late edit does not bring the task back").toBeNull();
      } finally {
        await closeTabs(session);
        await cleanUpCase(id);
      }
    });
  }
});

/** The teammate opens list A and adds a task to it offline: one queued create. */
async function queueCreateOffline(b: Tab, f: Fixture, title: string) {
  await b.bringToFront();
  await b.getByRole("button", { name: f.listA, exact: true }).click();
  await setTabOffline(b, true);
  await sleep(1_000);
  await quickAdd(b, title);
  expect((await tabCache(b, f.id)).outbox, `${b.tag} queued the create`).toEqual(["create"]);
}

// --- refused offline writes: the rescue dialog (#1825) ----------------------------------------

const REFUSALS = {
  "made read-only": {
    run: (_a: Tab, f: Fixture) => shareList(f.listAId, TEAMMATE, "read"),
    listStays: true,
  },
  deleted: { run: (a: Tab, f: Fixture) => ACTIONS.listDelete.run(a, f), listStays: false },
  revoked: { run: (a: Tab, f: Fixture) => ACTIONS.revoke.run(a, f), listStays: false },
};
type Refusal = keyof typeof REFUSALS;
type Rescue = "existing list" | "new list" | "discard";

/** One dialog per refused list: "A task from “M <id>”" or "2 tasks from …". */
function rescueDialog(tab: Tab) {
  return tab.getByRole("dialog", { name: /^(A task|\d+ tasks) from / });
}

/** Review in the notice bar under the header (#1894), the way back to the dialog. */
function rescueEntry(tab: Tab) {
  return tab
    .getByRole("region", { name: "Needs your attention" })
    .locator(".notice-bar__notice")
    .filter({ hasText: /needs? a new list/ })
    .getByRole("button", { name: "Review" });
}

/** A rescue into a new list keeps the old name, or "(copy)" when the old list stays. */
function rescuedListName(f: Fixture, refusal: Refusal) {
  return REFUSALS[refusal].listStays ? `${f.listA} (copy)` : f.listA;
}

/** The teammate's own lists the case made (a rescue into a new list), deleted as them. */
async function cleanUpTeammateLists(caseId: string) {
  const names = new Set([`M ${caseId}`, `M ${caseId} (copy)`]);
  for (const list of (await serverState(caseId, TEAMMATE).catch(() => null))?.lists ?? []) {
    // The owner's lists show up too; only the teammate's own are writable and unshared.
    if (!names.has(list.name) || !list.writable || list.shares.length > 0) continue;
    await api(TEAMMATE, "DELETE", `/tasks/tasklists/${encodeURIComponent(list.id)}`, {
      onDestroyRemoveContents: true,
    });
  }
}

/** Queue the teammate's write offline, refuse it, reconnect: the rescue dialog asks. */
async function refuseOffline(
  a: Tab,
  b: Tab,
  f: Fixture,
  kind: "create" | "edit",
  refusal: Refusal,
): Promise<string> {
  const title = kind === "create" ? `N ${f.id}` : `${f.task} mate`;
  if (kind === "create") await queueCreateOffline(b, f, title);
  else await queueEditOffline(b, f, title);
  await a.bringToFront();
  await showAllTasks(a);
  await REFUSALS[refusal].run(a, f);
  await b.bringToFront();
  await setTabOffline(b, false);
  return title;
}

async function chooseRescue(b: Tab, f: Fixture, refusal: Refusal, rescue: Rescue) {
  const dialog = rescueDialog(b);
  await expect(dialog, "the rescue dialog asks").toBeVisible({ timeout: 30_000 });
  await expect(dialog, "it names the refused list").toHaveAccessibleName(
    `A task from “${f.listA}”`,
  );
  await expect(conflictDialog(b), "no sync conflict").toHaveCount(0);
  if (rescue === "discard") {
    await dialog.getByRole("button", { name: /^Discard/ }).click();
  } else {
    if (rescue === "existing list") {
      await dialog.getByRole("button", { name: "Move to: New list" }).click();
      // Only lists the teammate can write to: never the refused one.
      await expect(b.getByRole("menuitem", { name: f.listA, exact: true })).toHaveCount(0);
      await b.getByRole("menuitem", { name: f.listB, exact: true }).click();
    } else {
      await expect(dialog.getByRole("textbox", { name: "Name of the new list" })).toHaveValue(
        rescuedListName(f, refusal),
      );
    }
    await dialog.getByRole("button", { name: /^Move (task|\d+ tasks)$/ }).click();
  }
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expect(rescueEntry(b)).toHaveCount(0);
}

async function expectRescued(f: Fixture, title: string, refusal: Refusal, rescue: Rescue) {
  const copiesOf = async () => {
    const state = await serverState(f.id, TEAMMATE);
    return { state, copies: state.tasks.filter((task) => task.title === title) };
  };
  if (rescue === "discard") {
    expect((await copiesOf()).copies, "a discarded task is nowhere").toEqual([]);
    return;
  }
  // The dialog closes once the writes are claimed; the list and task land on the server after.
  await expect
    .poll(async () => (await copiesOf()).copies.length, {
      message: "exactly one rescued copy",
      timeout: 15_000,
    })
    .toBe(1);
  const { state: mate, copies } = await copiesOf();
  expect(copies, "exactly one rescued copy").toHaveLength(1);
  const list = mate.lists.find((entry) => entry.id === copies[0]!.listId);
  expect(list?.name).toBe(rescue === "new list" ? rescuedListName(f, refusal) : f.listB);
}

test.describe("a refused offline write is rescued", () => {
  for (const kind of ["create", "edit"] as const) {
    for (const refusal of Object.keys(REFUSALS) as Refusal[]) {
      for (const rescue of ["existing list", "new list", "discard"] as const) {
        test(`${kind} · list ${refusal} · ${rescue}`, async ({ browser }) => {
          const id = caseId();
          let session: Session | null = null;
          try {
            const f = await seed(id, { teammate: true });
            session = await openTabs(browser, "diff");
            const all = session.tabs;
            const [a, b] = all as [Tab, Tab];
            await expectLoaded(session, id);
            const title = await refuseOffline(a, b, f, kind, refusal);
            await chooseRescue(b, f, refusal, rescue);

            expect((await tabCache(b, f.id)).outbox, "nothing left queued").toEqual([]);
            await expectRescued(f, title, refusal, rescue);
            if (kind === "edit" && REFUSALS[refusal].listStays) {
              expect((await serverTask(f.taskId))?.title, "the original is untouched").toBe(f.task);
            }
            if (!REFUSALS[refusal].listStays) {
              // A rescue into a new list made a list of the same name; the old one is gone.
              await expect(sidebarList(b, f.listA)).toHaveCount(rescue === "new list" ? 1 : 0);
              await expect(b).not.toHaveTitle(new RegExp(f.listAId));
            }
            expect(await converge(all, id, MIRROR_MS), "every tab mirrors the server").toEqual({});
            await hardRefresh([b]);
            await expectNoConflict(b);
            await expect(rescueDialog(b), "the choice holds after a refresh").toHaveCount(0);
            await expect(rescueEntry(b)).toHaveCount(0);
          } finally {
            await closeTabs(session);
            await cleanUpTeammateLists(id);
            await cleanUpCase(id);
          }
        });
      }
    }
  }

  test("closed without a choice, it waits and comes back after a refresh", async ({ browser }) => {
    const id = caseId();
    let session: Session | null = null;
    try {
      const f = await seed(id, { teammate: true });
      session = await openTabs(browser, "diff");
      const [a, b] = session.tabs as [Tab, Tab];
      await expectLoaded(session, id);
      const title = await refuseOffline(a, b, f, "create", "deleted");
      await expect(rescueDialog(b)).toBeVisible({ timeout: 30_000 });
      await rescueDialog(b).getByRole("button", { name: "Decide later" }).click();
      await expect(rescueEntry(b)).toBeVisible();
      await hardRefresh([b]);
      await expect(rescueDialog(b), "it comes back").toBeVisible({ timeout: 15_000 });
      await rescueDialog(b).getByRole("button", { name: "Decide later" }).click();
      await rescueEntry(b).click();
      await chooseRescue(b, f, "deleted", "new list");
      await expectRescued(f, title, "deleted", "new list");
    } finally {
      await closeTabs(session);
      await cleanUpTeammateLists(id);
      await cleanUpCase(id);
    }
  });

  test("a refresh in the middle of a move brings the task back, once", async ({ browser }) => {
    const id = caseId();
    let session: Session | null = null;
    try {
      const f = await seed(id, { teammate: true });
      session = await openTabs(browser, "diff");
      const [a, b] = session.tabs as [Tab, Tab];
      await expectLoaded(session, id);
      const title = await refuseOffline(a, b, f, "create", "deleted");
      const dialog = rescueDialog(b);
      await expect(dialog).toBeVisible({ timeout: 30_000 });
      await dialog.getByRole("button", { name: "Move to: New list" }).click();
      await b.getByRole("menuitem", { name: f.listB, exact: true }).click();

      // The create never gets an answer: the tab dies with the write in flight.
      const itemsUrl = (url: URL) => url.pathname.endsWith("/api/v1/tasks/items");
      const handler = async (route: Route) => {
        if (route.request().method() === "POST") return;
        await route.fallback();
      };
      await b.route(itemsUrl, handler);
      const sent = b.waitForRequest(
        (request) => request.method() === "POST" && itemsUrl(new URL(request.url())),
      );
      await dialog.getByRole("button", { name: /^Move (task|\d+ tasks)$/ }).click();
      await sent;
      await hardRefresh([b]);
      await b.unroute(itemsUrl, handler);

      expect(
        (await serverState(f.id, TEAMMATE)).tasks.filter((task) => task.title === title),
        "the server has no copy yet",
      ).toEqual([]);
      await chooseRescue(b, f, "deleted", "existing list");
      await expectRescued(f, title, "deleted", "existing list");
      expect((await tabCache(b, f.id)).outbox, "nothing left queued").toEqual([]);
    } finally {
      await closeTabs(session);
      await cleanUpTeammateLists(id);
      await cleanUpCase(id);
    }
  });

  test("two tabs · one asks, the other follows, no duplicates", async ({ browser }) => {
    const id = caseId();
    let session: Session | null = null;
    try {
      const f = await seed(id, { teammate: true });
      session = await openTabs(browser, "diff");
      const [a, b] = session.tabs as [Tab, Tab];
      const b2 = await openTasksTab(session.contexts[1]!, "B2", session.events, TEAMMATE);
      session.tabs.push(b2);
      await expectLoaded(session, id);
      await setTabOffline(b2, true);
      const title = await refuseOffline(a, b, f, "create", "revoked");
      await setTabOffline(b2, false);

      // One tab shows the dialog; the other only the way back to it.
      await expect
        .poll(async () => (await rescueDialog(b).count()) + (await rescueDialog(b2).count()), {
          message: "exactly one tab asks",
          timeout: 30_000,
        })
        .toBe(1);
      const [asking, other] = (await rescueDialog(b).count()) ? [b, b2] : [b2, b];
      await other.bringToFront();
      await expect(rescueEntry(other)).toBeVisible({ timeout: 15_000 });
      await rescueEntry(other).click();
      await expect(other.getByText(/open in another Tasks tab/)).toBeVisible();
      await expect(rescueDialog(other)).toHaveCount(0);

      await asking.bringToFront();
      await chooseRescue(asking, f, "revoked", "existing list");
      await expect(rescueEntry(other), "the other tab follows").toHaveCount(0, { timeout: 15_000 });
      await expect(row(other, title)).toHaveCount(1, { timeout: 15_000 });
      await expectRescued(f, title, "revoked", "existing list");
    } finally {
      await closeTabs(session);
      await cleanUpCase(id);
    }
  });
});

test.describe("inbound", () => {
  // Changes elsewhere reach every tab through the changes token, online and
  // after a reconnect, without a full re-list.
  for (const tabs of ["one", "same", "diff"] as const) {
    for (const net of ["on", "both"] as const) {
      test(`elsewhere · token · ${tabs} · ${net}`, async ({ browser }) => {
        const id = caseId();
        let session: Session | null = null;
        try {
          const f = await seed(id, { task: null, teammate: tabs === "diff" });
          const [t1, t2, t3] = [
            await createTask(f.listAId, `T1 ${id}`),
            await createTask(f.listAId, `T2 ${id}`),
            await createTask(f.listAId, `T3 ${id}`),
          ];
          session = await openTabs(browser, tabs);
          const all = session.tabs;
          await expectLoaded(session, id);
          const before = await Promise.all(all.map(async (tab) => (await tabCache(tab, id)).token));
          const calls = watchChanges(all);

          if (net === "both") for (const tab of all) await setTabOffline(tab, true);
          await patchTask(t1!.id, { title: `T1 ${id} v2` });
          await patchTask(t2!.id, { workflowStatus: "completed" });
          await deleteTask(t3!.id);
          await createTask(f.listAId, `T4 ${id}`);
          if (net === "both") {
            await sleep(2_000);
            for (const tab of all) await setTabOffline(tab, false);
          }

          expect(await converge(all, id, MIRROR_MS), "every tab mirrors the server").toEqual({});
          for (const [i, tab] of all.entries()) {
            expect((await tabCache(tab, id)).token, `${tab.tag} moved its token`).not.toBe(
              before[i],
            );
          }
          expect(calls.since, "pulled through the token").toBeGreaterThan(0);
          expect(calls.full, "no full re-list").toBe(0);
        } finally {
          await closeTabs(session);
          await cleanUpCase(id);
        }
      });
    }
  }

  test("elsewhere · full list on an unknown token · keeps a queued create", async ({ browser }) => {
    const id = caseId();
    let session: Session | null = null;
    try {
      const c = await inboundCase(browser, id, 2);
      session = c.session;
      const listCId = await createList(`M ${id} c`);
      await createTask(listCId, `T5 ${id}`);
      expect(await converge([c.tab], id, MIRROR_MS), "the tab loads list C").toEqual({});

      const release = await holdRequests(c.tab, "POST", "/tasks/items");
      await ACTIONS.create.run(c.tab, c.f);
      const unblock = await blockChanges(c.tab);
      await setStoredToken(c.tab, "expired-token");
      await deleteTask(c.tasks[0]!);
      await patchTask(c.tasks[1]!, { title: `T2 ${id} v2` });
      await deleteList(listCId);
      const calls = watchChanges([c.tab]);
      await unblock();

      await pollCache(
        c.tab,
        id,
        (cache) => cache.tasks.some((t) => t.title === `T2 ${id} v2`),
        "the full list lands",
      ).toBe(true);
      expect(
        calls.sinces.slice(0, 2),
        "the stale token was tried, then a full list followed",
      ).toEqual(["expired-token", null]);
      expect(calls.full, "the unknown token fell back to a full list").toBeGreaterThan(0);
      const cache = await tabCache(c.tab, id);
      expect(cache.token, "a fresh token").not.toBe("expired-token");
      expect(cache.tasks.map((t) => t.title).sort()).toEqual(
        [`B ${id}`, `N ${id}`, `T2 ${id} v2`].sort(),
      );
      expect(cache.tasks.find((t) => t.title === `N ${id}`)?.pending, "queued create kept").toBe(
        true,
      );
      expect(cache.lists.map((l) => l.name).sort(), "list C is gone").toEqual(
        [c.f.listA, c.f.listB].sort(),
      );

      await release();
      await reconnect(c.tab);
      expect(await converge([c.tab], id, MIRROR_MS), "the queued create lands").toEqual({});
      expect((await serverState(id)).tasks.some((t) => t.title === `N ${id}`)).toBe(true);
    } finally {
      await closeTabs(session);
      await cleanUpCase(id);
    }
  });

  test("elsewhere · full list with no stored token", async ({ browser }) => {
    const id = caseId();
    let session: Session | null = null;
    try {
      const c = await inboundCase(browser, id, 2);
      session = c.session;
      const unblock = await blockChanges(c.tab);
      await setStoredToken(c.tab, null);
      await patchTask(c.tasks[0]!, { title: `T1 ${id} v2` });
      await deleteTask(c.tasks[1]!);
      const calls = watchChanges([c.tab]);
      await unblock();
      expect(await converge([c.tab], id, MIRROR_MS), "the tab mirrors the server").toEqual({});
      expect(calls.sinces[0], "the first pull after the edits had no `since`").toBeNull();
      expect(calls.full, "no token: a full list").toBeGreaterThan(0);
      expect((await tabCache(c.tab, id)).token, "a token again").not.toBeNull();
    } finally {
      await closeTabs(session);
      await cleanUpCase(id);
    }
  });

  test("elsewhere · token re-list drops a deleted task, keeps a queued create", async ({
    browser,
  }) => {
    const id = caseId();
    let session: Session | null = null;
    try {
      const c = await inboundCase(browser, id, 1);
      session = c.session;
      const release = await holdRequests(c.tab, "POST", "/tasks/items");
      await ACTIONS.create.run(c.tab, c.f);
      const calls = watchChanges([c.tab]);
      await deleteTask(c.tasks[0]!);

      await pollCache(
        c.tab,
        id,
        (cache) => cache.tasks.some((t) => t.title === `T1 ${id}`),
        "the deleted task leaves the cache",
      ).toBe(false);
      const cache = await tabCache(c.tab, id);
      expect(cache.tasks.find((t) => t.title === `N ${id}`)?.pending, "queued create kept").toBe(
        true,
      );
      expect(calls.full, "through the token").toBe(0);

      await release();
      await reconnect(c.tab);
      expect(await converge([c.tab], id, MIRROR_MS), "the queued create lands").toEqual({});
    } finally {
      await closeTabs(session);
      await cleanUpCase(id);
    }
  });

  test("conflict · a queued edit and an edit elsewhere since", async ({ browser }) => {
    const id = caseId();
    let session: Session | null = null;
    try {
      const c = await inboundCase(browser, id, 1);
      session = c.session;
      const release = await holdRequests(c.tab, "PATCH", `/tasks/items/${c.tasks[0]}`);
      await editTask(c.tab, `T1 ${id}`, { title: `T1 ${id} mine` });
      expect((await tabCache(c.tab, id)).outbox, "the edit is queued").toEqual(["update"]);
      await patchTask(c.tasks[0]!, { title: `T1 ${id} theirs` });

      await expect(conflictDialog(c.tab), "the moved server reports a conflict").toBeVisible({
        timeout: 2 * POLL_MS + 10_000,
      });
      const cache = await tabCache(c.tab, id);
      expect(cache.tasks.find((t) => t.id === c.tasks[0])?.title, "local edit kept").toBe(
        `T1 ${id} mine`,
      );

      await release();
      const keep = conflictDialog(c.tab).getByRole("button", { name: /Keep mine|Apply merged/ });
      await keep.first().click();
      await expect(conflictDialog(c.tab)).toHaveCount(0, { timeout: 15_000 });
      await expect
        .poll(async () => (await serverState(id)).tasks.find((t) => t.id === c.tasks[0])?.title, {
          message: "keep mine lands on the server",
          timeout: 30_000,
        })
        .toBe(`T1 ${id} mine`);
      expect(await converge([c.tab], id, MIRROR_MS), "the tab mirrors the server").toEqual({});
    } finally {
      await closeTabs(session);
      await cleanUpCase(id);
    }
  });

  test("no conflict · a queued edit whose task did not move elsewhere", async ({ browser }) => {
    const id = caseId();
    let session: Session | null = null;
    try {
      const c = await inboundCase(browser, id, 2);
      session = c.session;
      const release = await holdRequests(c.tab, "PATCH", `/tasks/items/${c.tasks[0]}`);
      await editTask(c.tab, `T1 ${id}`, { title: `T1 ${id} mine` });
      // Another task on the same list changes, so the list is re-listed.
      await patchTask(c.tasks[1]!, { title: `T2 ${id} v2` });

      await pollCache(
        c.tab,
        id,
        (cache) => cache.tasks.some((t) => t.title === `T2 ${id} v2`),
        "the list is re-listed",
      ).toBe(true);
      await expectNoConflict(c.tab);
      const cache = await tabCache(c.tab, id);
      const mine = cache.tasks.find((t) => t.id === c.tasks[0]);
      expect([mine?.title, mine?.pending], "local edit kept and still queued").toEqual([
        `T1 ${id} mine`,
        true,
      ]);

      await release();
      await reconnect(c.tab);
      expect(await converge([c.tab], id, MIRROR_MS), "the queued edit lands").toEqual({});
      expect((await serverState(id)).tasks.some((t) => t.title === `T1 ${id} mine`)).toBe(true);
    } finally {
      await closeTabs(session);
      await cleanUpCase(id);
    }
  });

  test("no conflict · a queued edit with no recorded base", async ({ browser }) => {
    const id = caseId();
    let session: Session | null = null;
    try {
      const c = await inboundCase(browser, id, 1);
      session = c.session;
      await queueEditWithoutBase(c.tab, c.tasks[0]!, `T1 ${id} mine`);
      const before = (await tabCache(c.tab, id)).token;
      await patchTask(c.tasks[0]!, { title: `T1 ${id} theirs` });

      await pollCache(c.tab, id, (cache) => cache.token !== before, "the change is pulled").toBe(
        true,
      );
      await expectNoConflict(c.tab);
      const mine = (await tabCache(c.tab, id)).tasks.find((t) => t.id === c.tasks[0]);
      expect([mine?.title, mine?.pending], "an unknown base is not moved").toEqual([
        `T1 ${id} mine`,
        true,
      ]);

      // Sending it is not the inbound contract: the API refuses a write
      // without If-Match, so the flush reports that one as a conflict.
    } finally {
      await closeTabs(session);
      await cleanUpCase(id);
    }
  });

  test("list delete · elsewhere, while one of its tasks has a queued edit", async ({ browser }) => {
    const id = caseId();
    let session: Session | null = null;
    try {
      const c = await inboundCase(browser, id, 2);
      session = c.session;
      const release = await holdRequests(c.tab, "PATCH", `/tasks/items/${c.tasks[0]}`);
      await editTask(c.tab, `T1 ${id}`, { title: `T1 ${id} mine` });
      await deleteList(c.f.listAId);

      await pollCache(
        c.tab,
        id,
        (cache) => cache.lists.some((l) => l.id === c.f.listAId),
        "the list leaves the cache",
      ).toBe(false);
      const cache = await tabCache(c.tab, id);
      expect(
        cache.tasks.map((t) => t.title).sort(),
        "its other task goes, the queued one stays",
      ).toEqual([`B ${id}`, `T1 ${id} mine`].sort());
      await expect(conflictDialog(c.tab), "the queued edit is a conflict").toBeVisible({
        timeout: 10_000,
      });
      await release();
    } finally {
      await closeTabs(session);
      await cleanUpCase(id);
    }
  });

  test("list delete · queued here, changes elsewhere do not bring it back", async ({ browser }) => {
    const id = caseId();
    let session: Session | null = null;
    try {
      const c = await inboundCase(browser, id, 1);
      session = c.session;
      const release = await holdRequests(c.tab, "DELETE", `/tasks/tasklists/${c.f.listAId}`);
      await ACTIONS.listDelete.run(c.tab, c.f);
      expect((await tabCache(c.tab, id)).outbox, "the delete is queued").toEqual(["listDelete"]);
      const calls = watchChanges([c.tab]);
      await createTask(c.f.listAId, `T9 ${id}`);
      await patchTask(c.tasks[0]!, { title: `T1 ${id} v2` });

      await expect
        .poll(() => calls.relisted.has(c.f.listAId), {
          message: "a pull re-lists the list",
          timeout: 2 * POLL_MS + 10_000,
        })
        .toBe(true);
      await sleep(1_500);
      const cache = await tabCache(c.tab, id);
      expect(
        cache.lists.map((l) => l.name),
        "the list stays gone",
      ).toEqual([c.f.listB]);
      expect(
        cache.tasks.map((t) => t.title),
        "its tasks stay gone",
      ).toEqual([`B ${id}`]);

      await release();
      await reconnect(c.tab);
      await expect
        .poll(async () => (await serverState(id)).lists.some((l) => l.id === c.f.listAId), {
          message: "the queued delete lands",
          timeout: 30_000,
        })
        .toBe(false);
      expect(await converge([c.tab], id, MIRROR_MS), "the tab mirrors the server").toEqual({});
    } finally {
      await closeTabs(session);
      await cleanUpCase(id);
    }
  });
});

// --- the "could not sync" notice bar row (#1894) -----------------------------------------------

/** The notice bar row for queued changes that fail to sync, under the header. */
function syncNotice(tab: Tab) {
  return tab
    .getByRole("region", { name: "Needs your attention" })
    .locator(".notice-bar__notice")
    .filter({ hasText: "Some changes could not sync. They are saved on this device." });
}

test("sync notice · a held edit shows Retry in every tab and clears once it lands", async ({
  browser,
}) => {
  const id = caseId();
  let session: Session | null = null;
  try {
    const c = await inboundCase(browser, id, 1);
    session = c.session;
    const a = c.tab;
    const title = `T1 ${id}`;
    // Hold on the whole context, so a second tab cannot land the write either.
    const release = await holdRequests(session.contexts[0]!, "PATCH", `/tasks/items/${c.tasks[0]}`);
    await editTask(a, title, { title: `${title} v2` });
    // The reconnect flush hits the held request and marks the queued row failed.
    await reconnect(a);

    const poll = { timeout: 2 * POLL_MS + 10_000 };
    await expect(syncNotice(a), "the failed write shows the row").toBeVisible(poll);
    await expect(syncNotice(a).getByRole("button", { name: "Retry" })).toBeEnabled();
    await expect(rescueEntry(a), "it is not a refused write").toHaveCount(0);

    await syncNotice(a).getByRole("button", { name: "Retry" }).click();
    await expect(syncNotice(a).getByRole("button", { name: "Retry" })).toBeEnabled(poll);
    await expect(syncNotice(a), "Retry while still held keeps the row").toBeVisible();

    await hardRefresh([a]);
    await expect(syncNotice(a), "the failed row survives a reload").toBeVisible(poll);

    const b = await openTasksTab(session.contexts[0]!, "A2", session.events);
    session.tabs.push(b);
    await expect(syncNotice(b), "another tab reads the same outbox").toBeVisible(poll);
    await expect(syncNotice(a)).toBeVisible();
    expect((await serverTask(c.tasks[0]!))?.title, "nothing landed while held").toBe(title);

    // Retry right after the release, before the failed flush retries on its own.
    await release();
    await syncNotice(a).getByRole("button", { name: "Retry" }).click();
    await expect(syncNotice(a)).toHaveCount(0, poll);
    await expect(syncNotice(b)).toHaveCount(0, poll);
    expect((await serverTask(c.tasks[0]!))?.title, "the server has the new title").toBe(
      `${title} v2`,
    );

    await hardRefresh([a, b]);
    for (const tab of [a, b]) {
      await expect(row(tab, `${title} v2`)).toBeVisible({ timeout: 15_000 });
      await expect(tab.getByRole("region", { name: "Needs your attention" })).toHaveCount(0);
    }
  } finally {
    await closeTabs(session);
    await cleanUpCase(id);
  }
});
