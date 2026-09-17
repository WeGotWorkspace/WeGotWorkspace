import type { MailAppBootstrap } from "@/lib/api/mock/mail-bootstrap";
import {
  parseApiErrorJson,
  wgwApiBaseUrl,
  wgwFetch,
  wgwFetchPrincipal,
  wgwReadJson,
} from "@/lib/api/wgw/http";
import { WGW_UI_SYSTEM_MAILBOXES } from "@/lib/api/wgw/mail-folder-utils";
import type {
  MailMailboxLoader,
  MailAPIOperations,
  MailboxSummary,
} from "@/mail-core/src/mail-types";
import type { Mail, MailAttachment } from "@/types/mail";
import {
  JmapClient,
  JmapMailClient,
  JmapRequestError,
  MAIL_CAPABILITY,
  type JmapEmail,
  type JmapMailbox,
} from "@/lib/jmap-client";
import type {
  WgwMailDraftRequest,
  WgwMailMessageDetail,
  WgwMailSendRequest,
} from "@/lib/api/wgw/types";

function toApiRelativePath(input: string): string {
  const base = wgwApiBaseUrl();
  const url = new URL(input, window.location.origin);
  const path = url.pathname + url.search;
  return path.startsWith(base) ? path.slice(base.length) : path;
}

function interpolateJmapUrl(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(vars[key] ?? ""));
}

let cachedClient: JmapClient | null = null;

export function createMailJmapClient(): JmapClient {
  return new JmapClient({
    sessionUrl: "/jmap/session",
    fetch: (input, init) => wgwFetch(toApiRelativePath(input), init ?? {}),
  });
}

export function mailJmapClient(): JmapClient {
  if (!cachedClient) {
    cachedClient = createMailJmapClient();
  }
  return cachedClient;
}

export function resetMailJmapClient(): void {
  cachedClient = null;
}

const LIST_PROPERTIES = [
  "id",
  "blobId",
  "threadId",
  "mailboxIds",
  "keywords",
  "subject",
  "preview",
  "from",
  "receivedAt",
  "hasAttachment",
];

function mailboxUiLabel(mailbox: JmapMailbox): string {
  switch (mailbox.role) {
    case "inbox":
      return "Inbox";
    case "sent":
      return "Sent";
    case "drafts":
      return "Drafts";
    case "junk":
      return "Spam";
    case "archive":
      return "Archive";
    case "trash":
      return "Trash";
    default:
      return mailbox.name || "Mailbox";
  }
}

function parseEmailUid(id: string): number {
  const parts = id.split(":");
  const last = parts[parts.length - 1];
  const uid = Number(last);
  return Number.isFinite(uid) ? uid : 0;
}

function primaryMailboxId(email: JmapEmail): string {
  const ids = Object.keys(email.mailboxIds ?? {}).filter((key) => email.mailboxIds?.[key]);
  return ids[0] ?? "";
}

export function jmapEmailToMail(
  email: JmapEmail,
  mailboxNames: Record<string, string>,
  mailboxDisplay?: string,
): Mail {
  const folder = primaryMailboxId(email);
  const from = email.from?.[0];
  const preview = email.preview?.trim() ?? "";
  const text =
    email.bodyValues && email.textBody?.[0]?.partId
      ? email.bodyValues[email.textBody[0].partId]?.value
      : undefined;
  const html =
    email.bodyValues && email.htmlBody?.[0]?.partId
      ? email.bodyValues[email.htmlBody[0].partId]?.value
      : undefined;
  const attachments: MailAttachment[] | undefined = email.attachments?.map((part) => ({
    id: part.blobId ?? part.partId,
    name: part.name || "attachment",
    size: part.size,
    type: part.type,
    part: part.partId ?? part.blobId,
  }));
  return {
    id: email.id,
    title: email.subject?.trim() || "(no subject)",
    from: from?.name?.trim() || from?.email || "",
    email: from?.email || "",
    mailbox: mailboxDisplay ?? mailboxNames[folder] ?? "Inbox",
    unread: email.keywords?.["$seen"] !== true,
    folder,
    uid: parseEmailUid(email.id),
    date: email.receivedAt || new Date().toISOString(),
    excerpt: preview,
    body: text ? [text] : preview ? [preview] : [],
    bodyHtml: html,
    category: "mail",
    notebook: mailboxDisplay ?? mailboxNames[folder] ?? "Inbox",
    tags: [],
    wordCount: (text ?? preview).split(/\s+/).filter(Boolean).length,
    starred: email.keywords?.["$flagged"] === true,
    attachments,
    detailLoaded: Boolean(text || html),
    threadId: email.threadId,
    mailboxIds: email.mailboxIds,
  };
}

function jmapEmailToDetail(email: JmapEmail): WgwMailMessageDetail {
  const folder = primaryMailboxId(email);
  const text =
    email.bodyValues && email.textBody?.[0]?.partId
      ? email.bodyValues[email.textBody[0].partId]?.value
      : "";
  const html =
    email.bodyValues && email.htmlBody?.[0]?.partId
      ? (email.bodyValues[email.htmlBody[0].partId]?.value ?? null)
      : null;
  const from = email.from?.[0];
  return {
    folder,
    uid: parseEmailUid(email.id),
    body: text || email.preview || "",
    bodyHtml: html,
    id: email.id,
    folderId: folder,
    from: from ? { name: from.name ?? undefined, email: from.email } : undefined,
    subject: email.subject,
    preview: email.preview,
    date: email.receivedAt,
    read: email.keywords?.["$seen"] === true,
    starred: email.keywords?.["$flagged"] === true,
    attachments: email.attachments?.map((part) => ({
      id: part.blobId ?? part.partId,
      name: part.name || "attachment",
      size: part.size,
      type: part.type,
      part: part.partId,
    })),
  };
}

async function mailStatusError(): Promise<string | null> {
  const res = await wgwFetch("/mail/status");
  if (!res.ok) return `GET /mail/status failed (${res.status})`;
  const json = (await wgwReadJson(res)) as { error?: string | null; ready?: boolean };
  if (json.ready === true) return null;
  return typeof json.error === "string" && json.error !== "" ? json.error : "MAIL_SETTINGS_MISSING";
}

async function connectedMail(): Promise<{ accountId: string; mail: JmapMailClient }> {
  const client = mailJmapClient();
  if (!client.isConnected) {
    await client.connect();
  }
  if (!(MAIL_CAPABILITY in client.session.capabilities)) {
    throw new Error("MAIL_SETTINGS_MISSING");
  }
  const accountId = client.primaryAccountId(MAIL_CAPABILITY);
  return { accountId, mail: new JmapMailClient(client) };
}

function mailboxIdForLabel(label: string, mailboxes: JmapMailbox[]): string | undefined {
  const want = label.trim().toLowerCase();
  const roleMap: Record<string, string> = {
    inbox: "inbox",
    sent: "sent",
    drafts: "drafts",
    spam: "junk",
    junk: "junk",
    archive: "archive",
    trash: "trash",
  };
  const role = roleMap[want];
  if (role) {
    const byRole = mailboxes.find((box) => box.role === role);
    if (byRole) return byRole.id;
  }
  const byName = mailboxes.find((box) => mailboxUiLabel(box).toLowerCase() === want);
  return byName?.id;
}

function splitAddresses(raw: string | undefined): Array<{ email: string }> {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((email) => ({ email }));
}

async function uploadRfc822(
  client: JmapClient,
  accountId: string,
  rfc822: string,
): Promise<string> {
  const session = client.session;
  const url = interpolateJmapUrl(session.uploadUrl, { accountId });
  const res = await wgwFetch(toApiRelativePath(url), {
    method: "POST",
    headers: { "Content-Type": "message/rfc822" },
    body: rfc822,
  });
  if (!res.ok) {
    const body = parseApiErrorJson(await res.text());
    throw new Error(
      `POST /jmap/upload failed (${res.status})${body ? `: ${JSON.stringify(body)}` : ""}`,
    );
  }
  const json = (await wgwReadJson(res)) as { blobId?: string };
  if (!json.blobId) throw new Error("JMAP upload did not return a blobId");
  return json.blobId;
}

function buildRfc822(
  from: { name: string; email: string },
  input: WgwMailDraftRequest | WgwMailSendRequest,
): string {
  const headers = [
    `From: ${from.name} <${from.email}>`,
    input.to ? `To: ${input.to}` : "",
    input.cc ? `Cc: ${input.cc}` : "",
    input.bcc ? `Bcc: ${input.bcc}` : "",
    `Subject: ${input.subject ?? ""}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    input.body ?? "",
  ];
  return headers.filter((line, index) => line !== "" || index > 4).join("\r\n");
}

export function createJmapMailOperations(_mailboxLoader?: MailMailboxLoader): MailAPIOperations {
  const emailIdOf = (message: Pick<Mail, "folder" | "uid"> & { id?: string }) =>
    message.id?.includes(":") ? message.id : `${message.folder}:${message.uid}`;

  return {
    patchMessage: async (message, patch) => {
      const { accountId, mail } = await connectedMail();
      const keywords: Record<string, unknown> = {};
      if (patch.read !== undefined) keywords["keywords/$seen"] = patch.read;
      if (patch.starred !== undefined) keywords["keywords/$flagged"] = patch.starred;
      const response = await mail.setEmails({
        accountId,
        update: { [emailIdOf(message)]: keywords },
      });
      const err = response.notUpdated?.[emailIdOf(message)];
      if (err) throw new Error(err.description ?? err.type);
    },
    moveMessages: async (messages, toMailboxLabel) => {
      const { accountId, mail } = await connectedMail();
      const boxes = await mail.getMailboxes(accountId);
      const target = mailboxIdForLabel(toMailboxLabel, boxes.list);
      if (!target) throw new Error(`Unknown mailbox ${toMailboxLabel}`);
      const update: Record<string, Record<string, unknown>> = {};
      for (const message of messages) {
        update[emailIdOf(message)] = { mailboxIds: { [target]: true } };
      }
      const response = await mail.setEmails({ accountId, update });
      const failed = Object.values(response.notUpdated ?? {})[0];
      if (failed) throw new Error(failed.description ?? failed.type);
    },
    deleteMessages: async (messages) => {
      const { accountId, mail } = await connectedMail();
      const response = await mail.setEmails({
        accountId,
        destroy: messages.map((message) => emailIdOf(message)),
      });
      const failed = Object.values(response.notDestroyed ?? {})[0];
      if (failed) throw new Error(failed.description ?? failed.type);
    },
    createDraft: (input, opts) => saveJmapDraft(input, opts),
    saveDraft: (input, opts) => saveJmapDraft(input, opts),
    sendMessage: async (input) => {
      const { accountId, mail } = await connectedMail();
      const identities = await mail.getIdentities(accountId);
      const identity = identities.list[0];
      if (!identity) throw new Error("No mail identity is configured.");
      const boxes = await mail.getMailboxes(accountId);
      const draftsId =
        mailboxIdForLabel("Drafts", boxes.list) ?? mailboxIdForLabel("Inbox", boxes.list);
      const client = mailJmapClient();
      const blobId = await uploadRfc822(
        client,
        accountId,
        buildRfc822({ name: identity.name, email: identity.email }, input),
      );
      const created = await mail.setEmails({
        accountId,
        create: {
          k0: {
            blobId,
            mailboxIds: draftsId ? { [draftsId]: true } : undefined,
            keywords: { $draft: true },
          },
        },
      });
      const emailId = created.created?.k0?.id;
      if (!emailId) {
        const err = created.notCreated?.k0;
        throw new Error(err?.description ?? "Could not create message to send.");
      }
      const submitted = await mail.setEmailSubmissions({
        accountId,
        create: {
          s0: {
            identityId: identity.id,
            emailId,
            envelope: {
              mailFrom: { email: identity.email },
              rcptTo: [
                ...splitAddresses(input.to),
                ...splitAddresses(input.cc),
                ...splitAddresses(input.bcc),
              ],
            },
          },
        },
      });
      const fail = submitted.notCreated?.s0;
      if (fail) throw new Error(fail.description ?? fail.type);
    },
    fetchMessageDetail: async (message) => {
      const { accountId, mail } = await connectedMail();
      const got = await mail.getEmails(
        accountId,
        [emailIdOf(message)],
        [
          "id",
          "blobId",
          "threadId",
          "mailboxIds",
          "keywords",
          "subject",
          "preview",
          "from",
          "to",
          "cc",
          "receivedAt",
          "textBody",
          "htmlBody",
          "attachments",
          "bodyValues",
          "hasAttachment",
        ],
      );
      const email = got.list[0];
      return email ? jmapEmailToDetail(email) : null;
    },
    downloadAttachment: async (message, attachment) => {
      const { accountId, mail } = await connectedMail();
      const got = await mail.getEmails(
        accountId,
        [emailIdOf(message)],
        ["attachments", "htmlBody", "textBody"],
      );
      const email = got.list[0];
      const blobId =
        attachment.part && attachment.part.startsWith("mb-")
          ? attachment.part
          : email?.attachments?.find(
              (part) => part.partId === attachment.part || part.blobId === attachment.id,
            )?.blobId;
      if (!blobId) throw new Error("Attachment blob was not found.");
      const client = mailJmapClient();
      const url = interpolateJmapUrl(client.session.downloadUrl, {
        accountId,
        blobId,
        name: attachment.name || "attachment",
        type: attachment.type || "application/octet-stream",
      });
      const res = await wgwFetch(toApiRelativePath(url));
      if (!res.ok) throw new Error(`GET /jmap/download failed (${res.status})`);
      return await res.blob();
    },
  };
}

async function saveJmapDraft(input: WgwMailDraftRequest, _opts?: { signal?: AbortSignal }) {
  const { accountId, mail } = await connectedMail();
  const identities = await mail.getIdentities(accountId);
  const identity = identities.list[0];
  if (!identity) throw new Error("No mail identity is configured.");
  const boxes = await mail.getMailboxes(accountId);
  const draftsId = mailboxIdForLabel("Drafts", boxes.list);
  const client = mailJmapClient();
  const blobId = await uploadRfc822(
    client,
    accountId,
    buildRfc822({ name: identity.name, email: identity.email }, input),
  );
  const created = await mail.setEmails({
    accountId,
    create: {
      d0: {
        blobId,
        mailboxIds: draftsId ? { [draftsId]: true } : undefined,
        keywords: { $draft: true },
      },
    },
  });
  const err = created.notCreated?.d0;
  if (err) throw new Error(err.description ?? err.type);
}

export async function fetchMailLiveBootstrap(): Promise<MailAppBootstrap> {
  const statusError = await mailStatusError();
  if (statusError) {
    throw new Error(statusError);
  }
  const session = await wgwFetchPrincipal();
  let accountId: string;
  let mail: JmapMailClient;
  try {
    ({ accountId, mail } = await connectedMail());
  } catch (error) {
    if (error instanceof JmapRequestError) {
      throw new Error("MAIL_SETTINGS_MISSING");
    }
    throw error;
  }

  const boxes = await mail.getMailboxes(accountId);
  const mailboxNames: Record<string, string> = {};
  for (const box of boxes.list) {
    mailboxNames[box.id] = mailboxUiLabel(box);
  }
  const inbox = boxes.list.find((box) => box.role === "inbox") ?? boxes.list[0];
  const extra = boxes.list
    .map((box) => mailboxUiLabel(box))
    .filter(
      (label) =>
        label !== "Inbox" &&
        label !== "Starred" &&
        !WGW_UI_SYSTEM_MAILBOXES.includes(label as (typeof WGW_UI_SYSTEM_MAILBOXES)[number]),
    );
  const mailboxLabels = ["Inbox", "Starred", ...WGW_UI_SYSTEM_MAILBOXES, ...extra];
  const seen = new Set<string>();
  const mailboxes: MailboxSummary[] = mailboxLabels
    .filter((label) => {
      if (seen.has(label)) return false;
      seen.add(label);
      return true;
    })
    .map((label) => {
      const box = boxes.list.find((item) => mailboxUiLabel(item) === label);
      return box?.unreadEmails !== undefined ? { label, unreadCount: box.unreadEmails } : { label };
    });

  const mailboxLoader: MailMailboxLoader = {
    folderTokenForLabel: (label) => mailboxIdForLabel(label, boxes.list),
    async loadMailbox(mailboxLabel, opts) {
      const isStarred = mailboxLabel.trim().toLowerCase() === "starred";
      const mailboxId = isStarred ? inbox?.id : mailboxIdForLabel(mailboxLabel, boxes.list);
      if (!mailboxId && !isStarred) {
        return { rows: [], hasMore: false, nextOffset: opts?.offset ?? 0 };
      }
      const filter = isStarred
        ? { hasKeyword: "$flagged", ...(mailboxId ? { inMailbox: mailboxId } : {}) }
        : mailboxId
          ? {
              inMailbox: mailboxId,
              ...(opts?.query?.trim() ? { text: opts.query.trim() } : {}),
            }
          : undefined;
      const got = await mail.getEmailsByQuery(accountId, filter, {
        position: opts?.offset ?? 0,
        limit: opts?.limit ?? 40,
        properties: LIST_PROPERTIES,
      });
      const sidebar = mailboxLabel;
      return {
        rows: got.list.map((email) => jmapEmailToMail(email, mailboxNames, sidebar)),
        hasMore: got.list.length >= (opts?.limit ?? 40),
        nextOffset: (opts?.offset ?? 0) + got.list.length,
      };
    },
  };

  const initial = inbox
    ? await mailboxLoader.loadMailbox("Inbox", { offset: 0, limit: 40 })
    : { rows: [], hasMore: false, nextOffset: 0 };

  return {
    data: { mail: initial.rows, mailboxes },
    session,
    mailboxLoader,
  };
}
