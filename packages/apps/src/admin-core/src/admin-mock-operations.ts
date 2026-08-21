import type {
  AdminAPIOperations,
  AdminUIData,
  AdminUpdateCheck,
  AdminUpdateState,
} from "@/admin-core/src/admin-types";

const MOCK_CHECK_RESULTS: AdminUpdateCheck[] = [
  { ok: true, label: "PHP runtime", detail: "Meets minimum version for this release." },
  { ok: true, label: "Database", detail: "Schema and migrations are consistent." },
  { ok: true, label: "Disk space", detail: "Enough free space for updates and backups." },
];

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = window.setTimeout(resolve, ms);
    const onAbort = () => {
      window.clearTimeout(id);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal) {
      if (signal.aborted) {
        window.clearTimeout(id);
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function cloneData(data: AdminUIData): AdminUIData {
  return structuredClone(data);
}

function applySettingsMap(
  data: AdminUIData,
  values: Record<string, string | number | boolean | null>,
  opts?: { clearSmtpPassword?: boolean },
): void {
  const readString = (key: string) => {
    const v = values[key];
    return typeof v === "string" ? v : undefined;
  };
  const readNumber = (key: string) => {
    const v = values[key];
    return typeof v === "number" ? v : undefined;
  };
  const readBool = (key: string) => {
    const v = values[key];
    return typeof v === "boolean" ? v : undefined;
  };

  const imapHost = readString("mail_imap_host");
  if (imapHost !== undefined) data.mail.imapHost = imapHost;
  const imapPort = readNumber("mail_imap_port");
  if (imapPort !== undefined) data.mail.imapPort = imapPort;
  const imapSecurity = readString("mail_imap_security");
  if (imapSecurity !== undefined) data.mail.imapSecurity = imapSecurity;
  const smtpHost = readString("mail_smtp_host");
  if (smtpHost !== undefined) data.mail.smtpHost = smtpHost;
  const smtpPort = readNumber("mail_smtp_port");
  if (smtpPort !== undefined) data.mail.smtpPort = smtpPort;
  const smtpSecurity = readString("mail_smtp_security");
  if (smtpSecurity !== undefined) data.mail.smtpSecurity = smtpSecurity;

  const stunUrls = readString("rtc_stun_url");
  if (stunUrls !== undefined) data.rtc.stunUrls = stunUrls;
  const turnUrls = readString("rtc_turn_url");
  if (turnUrls !== undefined) data.rtc.turnUrls = turnUrls;
  const turnUsername = readString("rtc_turn_username");
  if (turnUsername !== undefined) data.rtc.turnUsername = turnUsername;
  const turnPassword = readString("rtc_turn_credential");
  if (turnPassword !== undefined) data.rtc.turnPassword = turnPassword;

  const calendars = readBool("calendar_enabled");
  if (calendars !== undefined) data.apps.calendars = calendars;
  const contacts = readBool("contacts_enabled");
  if (contacts !== undefined) data.apps.contacts = contacts;

  const sabreUi = readBool("browser_plugin");
  if (sabreUi !== undefined) data.webdav.sabreUi = sabreUi;
  const timezone = readString("timezone");
  if (timezone !== undefined) data.webdav.timezone = timezone;
  const baseUri = readString("base_uri");
  if (baseUri !== undefined) data.webdav.baseUri = baseUri;
  const authRealm = readString("auth_realm");
  if (authRealm !== undefined) data.webdav.authRealm = authRealm;

  const deliveryFrom = readString("mail_delivery_from");
  if (deliveryFrom !== undefined) data.mailDelivery.config.from = deliveryFrom;
  const deliveryTransport = readString("mail_delivery_transport");
  if (
    deliveryTransport === "auto" ||
    deliveryTransport === "smtp" ||
    deliveryTransport === "php" ||
    deliveryTransport === "sendmail"
  ) {
    data.mailDelivery.config.transport = deliveryTransport;
  }
  const deliveryHost = readString("mail_delivery_smtp_host");
  if (deliveryHost !== undefined) data.mailDelivery.config.smtpHost = deliveryHost;
  const deliveryPort = readNumber("mail_delivery_smtp_port");
  if (deliveryPort !== undefined) data.mailDelivery.config.smtpPort = deliveryPort;
  const deliverySecurity = readString("mail_delivery_smtp_security");
  if (deliverySecurity !== undefined) data.mailDelivery.config.smtpSecurity = deliverySecurity;
  const deliveryUser = readString("mail_delivery_smtp_username");
  if (deliveryUser !== undefined) data.mailDelivery.config.smtpUsername = deliveryUser;
  const deliveryPassword = readString("mail_delivery_smtp_password");
  if (opts?.clearSmtpPassword) {
    data.mailDelivery.config.smtpPasswordSet = false;
  } else if (deliveryPassword) {
    data.mailDelivery.config.smtpPasswordSet = true;
  }

  const fromConfigured = data.mailDelivery.config.from.includes("@");
  const smtpEligible =
    data.mailDelivery.config.smtpHost !== "" &&
    (data.mailDelivery.config.smtpUsername !== "" ||
      data.mailDelivery.config.smtpSecurity === "none");
  const selected =
    data.mailDelivery.config.transport === "smtp"
      ? smtpEligible || data.mailDelivery.config.smtpUsername !== ""
        ? "smtp"
        : null
      : data.mailDelivery.config.transport === "auto"
        ? smtpEligible
          ? "smtp"
          : "php"
        : data.mailDelivery.config.transport;
  data.mailDelivery.capability = {
    canSubmit: selected !== null,
    selectedTransport: selected,
    probes: {
      fromConfigured,
      smtpEligible,
      smtpAuthRequired: data.mailDelivery.config.smtpSecurity !== "none",
      phpMailAvailable: true,
      sendmailAvailable: false,
    },
  };
}

/**
 * In-memory admin API for Storybook and local mock mode (`wgwLiveApiEnabled()` false).
 * Mutates a private clone so repeated actions behave predictably.
 */
export function createMockAdminOperations(seed: AdminUIData): AdminAPIOperations {
  const current = cloneData(seed);
  let mockSearchRunning = false;

  const snapshot = () => cloneData(current);

  return {
    refreshState: async (opts) => {
      await sleep(120, opts?.signal);
      return snapshot();
    },
    saveSettings: async (values, opts) => {
      await sleep(150, opts?.signal);
      applySettingsMap(current, values, opts);
      return snapshot();
    },
    sendMailDeliveryTest: async (opts) => {
      await sleep(150, opts?.signal);
      const to = opts?.to?.trim() ?? "";
      if (to === "" || !to.includes("@")) {
        throw new Error("At least one recipient is required.");
      }
      const now = new Date().toISOString();
      if (!current.mailDelivery.capability.canSubmit) {
        current.mailDelivery.lastTestSend = {
          accepted: false,
          status: "unavailable",
          transport: current.mailDelivery.capability.selectedTransport ?? "",
          at: now,
          message: "Cannot submit with the current settings.",
        };
        return snapshot();
      }
      current.mailDelivery.lastTestSend = {
        accepted: true,
        status: "accepted_by_transport",
        transport: current.mailDelivery.capability.selectedTransport ?? "php",
        at: now,
        message: null,
      };
      return snapshot();
    },
    checkUpdates: async (opts) => {
      await sleep(400, opts?.signal);
      const checkedAt = new Date().toISOString();
      current.updates = {
        ...current.updates,
        lastCheckedAt: checkedAt,
        lastCheckError: null,
        checks: MOCK_CHECK_RESULTS,
        updateAvailable: Boolean(current.updates.latest),
      };
      return snapshot();
    },
    refreshUpdateState: async (opts) => {
      await sleep(80, opts?.signal);
      return cloneData(current).updates;
    },
    applyUpdate: async (_version, opts) => {
      await sleep(120, opts?.signal);
      throw new Error("Applying updates requires a live server connection.");
    },
    cancelUpdate: async (opts) => {
      await sleep(80, opts?.signal);
      const next: AdminUpdateState = { ...current.updates, inProgress: false, phase: null };
      current.updates = next;
      return cloneData(current).updates;
    },
    startSearchReindex: async (opts) => {
      await sleep(120, opts?.signal);
      current.searchReindex = {
        ...current.searchReindex,
        inProgress: true,
        phase: "indexing_files",
        phaseProgress: {
          completed: 1,
          total: 4,
          percent: 25,
          updatedAt: new Date().toISOString(),
        },
        cancelRequested: false,
        logLines: [
          ...current.searchReindex.logLines,
          `[${new Date().toISOString()}] Search reindex started.`,
        ],
      };
      mockSearchRunning = true;
      return cloneData(current).searchReindex;
    },
    refreshSearchReindexState: async (opts) => {
      await sleep(80, opts?.signal);
      if (mockSearchRunning && current.searchReindex.inProgress) {
        const now = new Date().toISOString();
        const prev = current.searchReindex.phaseProgress;
        const total = prev?.total ?? 4;
        const completed = Math.min(total, (prev?.completed ?? 0) + 1);
        const percent = Math.floor((completed / Math.max(1, total)) * 100);
        const done = completed >= total;
        current.searchReindex = {
          ...current.searchReindex,
          inProgress: !done,
          phase: done ? null : "indexing_files",
          phaseProgress: done
            ? null
            : {
                completed,
                total,
                percent,
                updatedAt: now,
              },
          lastResult: done
            ? {
                ok: true,
                message: "Search reindex completed.",
                finishedAt: now,
              }
            : current.searchReindex.lastResult,
          logLines: done
            ? [...current.searchReindex.logLines, `[${now}] Search reindex completed.`]
            : current.searchReindex.logLines,
        };
        if (done) {
          mockSearchRunning = false;
        }
      }
      return cloneData(current).searchReindex;
    },
    cancelSearchReindex: async (opts) => {
      await sleep(80, opts?.signal);
      const now = new Date().toISOString();
      current.searchReindex = {
        ...current.searchReindex,
        inProgress: false,
        phase: null,
        phaseProgress: null,
        cancelRequested: true,
        lastResult: {
          ok: false,
          message: "Search reindex cancelled by user.",
          finishedAt: now,
        },
        logLines: [
          ...current.searchReindex.logLines,
          `[${now}] Cancellation requested by admin user.`,
        ],
      };
      mockSearchRunning = false;
      return cloneData(current).searchReindex;
    },
    refreshUpdateLog: async (opts) => {
      await sleep(80, opts?.signal);
      return [...current.updateLogLines];
    },
    clearUpdateLog: async (opts) => {
      await sleep(80, opts?.signal);
      current.updateLogLines = [];
      return [];
    },
    deleteBackup: async (name, opts) => {
      await sleep(120, opts?.signal);
      current.updates = {
        ...current.updates,
        backups: current.updates.backups.filter((b) => b.name !== name),
      };
      return snapshot();
    },
    downloadBackup: async (_name, opts) => {
      await sleep(40, opts?.signal);
    },
    createBackup: async (opts) => {
      await sleep(200, opts?.signal);
      const stamp = new Date().toISOString().replace(/[:]/g, "-");
      current.updates = {
        ...current.updates,
        backups: [
          ...current.updates.backups,
          {
            name: `mock-backup-${stamp}.sql.gz`,
            sizeBytes: 1024,
            modifiedAt: new Date().toISOString(),
            fromVersion: current.updates.installedVersion,
            toVersion: current.updates.installedVersion,
            format: "gzip",
            downloadable: true,
          },
        ],
      };
      return snapshot();
    },
    createUser: async (input, opts) => {
      await sleep(120, opts?.signal);
      current.users = [
        ...current.users,
        {
          id: input.username,
          username: input.username,
          displayName: input.displayName,
          email: input.email ?? "",
          groups: input.groups ?? [],
          createdAt: new Date().toISOString(),
        },
      ];
      return snapshot();
    },
    updateUser: async (username, input, opts) => {
      await sleep(120, opts?.signal);
      current.users = current.users.map((u) =>
        u.username === username
          ? {
              ...u,
              displayName: input.displayName ?? u.displayName,
              email: input.email ?? u.email,
            }
          : u,
      );
      return snapshot();
    },
    deleteUser: async (username, opts) => {
      await sleep(120, opts?.signal);
      current.users = current.users.filter((u) => u.username !== username);
      return snapshot();
    },
    createGroup: async (input, opts) => {
      await sleep(120, opts?.signal);
      const slug = input.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-");
      const id = `principals/groups/${slug}`;
      current.groups = [
        ...current.groups,
        {
          id,
          name: input.name,
          displayName: input.displayName ?? input.name,
        },
      ];
      return snapshot();
    },
    updateGroup: async (groupSlug, input, opts) => {
      await sleep(120, opts?.signal);
      const id = groupSlug.startsWith("principals/groups/")
        ? groupSlug
        : `principals/groups/${groupSlug}`;
      current.groups = current.groups.map((g) =>
        g.id === id
          ? {
              ...g,
              displayName: input.displayName ?? g.displayName,
              name: input.displayName ?? g.name,
            }
          : g,
      );
      if (input.members) {
        current.users = current.users.map((u) => {
          const has = u.groups.includes(id);
          const should = input.members!.includes(u.username);
          if (has === should) return u;
          return {
            ...u,
            groups: should ? [...u.groups, id] : u.groups.filter((gid) => gid !== id),
          };
        });
      }
      return snapshot();
    },
    deleteGroup: async (groupSlug, opts) => {
      await sleep(120, opts?.signal);
      const id = groupSlug.startsWith("principals/groups/")
        ? groupSlug
        : `principals/groups/${groupSlug}`;
      current.groups = current.groups.filter((g) => g.id !== id);
      current.users = current.users.map((u) => ({
        ...u,
        groups: u.groups.filter((gid) => gid !== id),
      }));
      return snapshot();
    },
    activatePlugin: async (pluginId, opts) => {
      await sleep(120, opts?.signal);
      current.plugins = current.plugins.map((plugin) =>
        plugin.id === pluginId ? { ...plugin, active: true } : plugin,
      );
      return snapshot();
    },
    deactivatePlugin: async (pluginId, opts) => {
      await sleep(120, opts?.signal);
      current.plugins = current.plugins.map((plugin) =>
        plugin.id === pluginId ? { ...plugin, active: false } : plugin,
      );
      return snapshot();
    },
    installPluginZip: async (_file, opts) => {
      await sleep(200, opts?.signal);
      throw new Error("Plugin install from ZIP requires a live server connection.");
    },
  };
}
