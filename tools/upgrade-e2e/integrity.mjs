/**
 * Seed v0.1.99 and verify the same data after the current image migrates.
 *
 * REST and JMAP use the JWT from POST /api/v1/auth/token. WebDAV and CalDAV
 * use HTTP Basic, which is what Sabre accepts. Mail is not seeded.
 *
 *   node tools/upgrade-e2e/integrity.mjs seed
 *   node tools/upgrade-e2e/integrity.mjs verify
 */
import { writeFileSync, readFileSync } from "node:fs";

const base = (process.env.WGW_UPGRADE_BASE_URL ?? "").replace(/\/$/, "");
const manifestPath = process.env.WGW_UPGRADE_MANIFEST ?? "";
const adminUser = process.env.WGW_E2E_ADMIN_USER ?? "admin";
const adminPass = process.env.WGW_E2E_ADMIN_PASS ?? "longpassword99";
const memberUser = process.env.WGW_E2E_MEMBER_USER ?? "member";
const memberPass = process.env.WGW_E2E_MEMBER_PASS ?? "longpassword99";
const memberEmail = process.env.WGW_E2E_MEMBER_EMAIL ?? "member@e2e.test";

const eventTitle = "Upgrade Launch Review";
const fileName = "upgrade-note.txt";
const fileBody = "upgrade-v0.1.99-drive";
const contactName = "Upgrade Contact";
const contactEmail = "upgrade@e2e.test";

const CORE = "urn:ietf:params:jmap:core";
const CALENDARS = "urn:ietf:params:jmap:calendars";
const CONTACTS = "urn:ietf:params:jmap:contacts";
const FILENODE = "urn:ietf:params:jmap:filenode";

const mode = process.argv[2];

function fail(message, detail) {
  const extra = detail === undefined ? "" : `\n${JSON.stringify(detail, null, 2)}`;
  throw new Error(`${message}${extra}`);
}

async function request(path, { method = "GET", token, basic, body, contentType, depth, ok } = {}) {
  const headers = { Accept: "application/json, application/xml, text/plain, */*" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (basic) {
    headers.Authorization = `Basic ${Buffer.from(`${basic.user}:${basic.pass}`).toString("base64")}`;
  }
  if (depth !== undefined) {
    headers.Depth = depth;
  }
  let payload;
  if (body !== undefined) {
    if (typeof body === "string") {
      payload = body;
      headers["Content-Type"] = contentType ?? "application/xml; charset=utf-8";
    } else if (body instanceof Uint8Array) {
      payload = body;
      headers["Content-Type"] = contentType ?? "application/octet-stream";
    } else {
      payload = JSON.stringify(body);
      headers["Content-Type"] = "application/json";
    }
  }
  const response = await fetch(`${base}${path}`, { method, headers, body: payload });
  const text = await response.text();
  const statusOk = ok ? ok(response.status) : response.status >= 200 && response.status < 300;
  let parsed = text;
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("json") && text !== "") {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!statusOk) {
    fail(`${method} ${path} returned ${response.status}`, parsed);
  }
  return parsed;
}

async function login(username, password) {
  const body = await request("/api/v1/auth/token", {
    method: "POST",
    body: { username, password },
  });
  if (!body || typeof body.access_token !== "string" || body.access_token === "") {
    fail(`login for ${username} did not return an access token`, body);
  }
  return body;
}

async function jmap(token, using, methodCalls) {
  const body = await request("/api/v1/jmap", {
    method: "POST",
    token,
    body: { using, methodCalls },
  });
  const responses = body?.methodResponses;
  if (!Array.isArray(responses) || responses.length === 0) {
    fail("JMAP response missing methodResponses", body);
  }
  for (const row of responses) {
    if (row[0] === "error") {
      fail(`JMAP ${methodCalls.map((call) => call[0]).join(", ")} failed`, row);
    }
  }
  return body;
}

function createdId(payload, clientId) {
  const body = payload.methodResponses[0][1];
  const rejected = body?.notCreated?.[clientId];
  if (rejected) {
    fail(`JMAP did not create ${clientId}`, rejected);
  }
  const id = body?.created?.[clientId]?.id;
  if (typeof id !== "string" || id === "") {
    fail(`JMAP create ${clientId} returned no id`, body);
  }
  return id;
}

function methodBody(payload, method) {
  const row = payload.methodResponses.find((item) => item[0] === method);
  if (!row) {
    fail(`JMAP response missing ${method}`, payload);
  }
  return row[1];
}

function containsDeep(value, needle) {
  if (typeof value === "string") {
    return value.includes(needle);
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsDeep(item, needle));
  }
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => containsDeep(item, needle));
  }
  return false;
}

async function accountId(token) {
  const session = await request("/api/v1/jmap/session", { token });
  const primary = session?.primaryAccounts?.[CALENDARS]
    ?? session?.primaryAccounts?.[FILENODE]
    ?? session?.username;
  if (typeof primary !== "string" || primary === "") {
    fail("JMAP session has no account id", session);
  }
  return primary;
}

async function seed() {
  const admin = await login(adminUser, adminPass);
  if (admin.role !== "admin" || admin.username !== adminUser) {
    fail("installed admin principal is wrong", admin);
  }
  const token = admin.access_token;
  const account = await accountId(token);

  await request("/api/v1/admin/users", {
    method: "POST",
    token,
    body: {
      username: memberUser,
      password: memberPass,
      email: memberEmail,
      displayName: "Upgrade Member",
    },
  });
  const member = await login(memberUser, memberPass);
  if (member.username !== memberUser) {
    fail("seeded member cannot log in", member);
  }

  const event = await jmap(token, [CORE, CALENDARS], [[
    "CalendarEvent/set",
    {
      accountId: account,
      create: {
        e1: {
          calendarIds: { default: true },
          title: eventTitle,
          uid: "upgrade-v099-event",
          start: "2026-10-01T09:00:00Z",
          end: "2026-10-01T10:00:00Z",
        },
      },
    },
    "c0",
  ]]);
  const eventId = createdId(event, "e1");

  const nodes = await jmap(token, [CORE, FILENODE], [[
    "FileNode/get",
    { accountId: account, ids: null },
    "c0",
  ]]);
  const list = methodBody(nodes, "FileNode/get").list ?? [];
  const home = list.find((node) => node.parentId === null && node.name === account && node.nodeType === "directory");
  if (!home?.id) {
    fail("FileNode home directory missing", list.map((node) => ({ id: node.id, name: node.name, parentId: node.parentId })));
  }
  const uploaded = await request(`/api/v1/jmap/upload/${encodeURIComponent(account)}`, {
    method: "POST",
    token,
    body: new TextEncoder().encode(fileBody),
    contentType: "text/plain",
    ok: (status) => status === 201,
  });
  if (typeof uploaded.blobId !== "string") {
    fail("blob upload missing blobId", uploaded);
  }
  const file = await jmap(token, [CORE, FILENODE], [[
    "FileNode/set",
    {
      accountId: account,
      create: {
        f1: { parentId: home.id, name: fileName, blobId: uploaded.blobId },
      },
    },
    "c0",
  ]]);
  const fileId = createdId(file, "f1");

  const contact = await jmap(token, [CORE, CONTACTS], [[
    "ContactCard/set",
    {
      accountId: account,
      create: {
        c1: {
          addressBookIds: { default: true },
          name: { full: contactName },
          emails: {
            "550e8400-e29b-41d4-a716-446655440099": { address: contactEmail },
          },
        },
      },
    },
    "c0",
  ]]);
  const contactId = createdId(contact, "c1");

  const manifest = {
    accountId: account,
    eventId,
    fileId,
    contactId,
    eventTitle,
    fileName,
    fileBody,
    contactName,
    contactEmail,
    adminUser,
    memberUser,
  };
  if (manifestPath === "") {
    fail("WGW_UPGRADE_MANIFEST is required");
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Seeded upgrade fixture for ${adminUser} and ${memberUser}`);
}

const calendarReport = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT"/>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

const addressbookReport = `<?xml version="1.0" encoding="utf-8"?>
<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:prop>
    <d:getetag/>
    <card:address-data/>
  </d:prop>
</card:addressbook-query>`;

const propfind = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname/>
    <d:getetag/>
    <d:getcontentlength/>
  </d:prop>
</d:propfind>`;

async function dav(method, path, { body, depth, user, pass }) {
  return request(path, {
    method,
    basic: { user, pass },
    body,
    depth,
    ok: (status) => status === 200 || status === 207,
  });
}

async function verify() {
  if (manifestPath === "") {
    fail("WGW_UPGRADE_MANIFEST is required");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const admin = await login(adminUser, adminPass);
  if (admin.username !== adminUser || admin.role !== "admin") {
    fail("admin login after upgrade does not match the installed principal", admin);
  }
  const token = admin.access_token;
  const me = await request("/api/v1/me", { token });
  if (me.username !== adminUser) {
    fail("GET /api/v1/me username mismatch", me);
  }
  const member = await login(memberUser, memberPass);
  if (member.username !== memberUser) {
    fail("member login failed after upgrade", member);
  }
  const memberMe = await request("/api/v1/me", { token: member.access_token });
  if (memberMe.username !== memberUser) {
    fail("member /api/v1/me mismatch", memberMe);
  }

  const state = await request("/api/v1/admin/state", { token });
  const usernames = (state.users ?? []).map((user) => user.username);
  for (const name of [adminUser, memberUser]) {
    if (!usernames.includes(name)) {
      fail(`admin state is missing user ${name}`, usernames);
    }
  }

  const account = manifest.accountId;
  const calendars = await jmap(token, [CORE, CALENDARS], [[
    "Calendar/get",
    { accountId: account, ids: null },
    "c0",
  ]]);
  const calendarList = methodBody(calendars, "Calendar/get").list ?? [];
  if (!calendarList.some((calendar) => calendar.id === "default")) {
    fail("Calendar/get is missing the default calendar", calendarList);
  }
  const events = await jmap(token, [CORE, CALENDARS], [[
    "CalendarEvent/get",
    { accountId: account, ids: [manifest.eventId] },
    "c1",
  ]]);
  const eventList = methodBody(events, "CalendarEvent/get").list ?? [];
  if (!eventList.some((event) => event.title === manifest.eventTitle || event.id === manifest.eventId)) {
    fail("CalendarEvent/get lost the seeded event", methodBody(events, "CalendarEvent/get"));
  }

  const files = await jmap(token, [CORE, FILENODE], [[
    "FileNode/get",
    { accountId: account, ids: null },
    "c0",
  ]]);
  const fileList = methodBody(files, "FileNode/get").list ?? [];
  if (!fileList.some((node) => node.name === manifest.fileName)) {
    fail("FileNode/get lost the seeded drive file", fileList.map((node) => node.name));
  }

  const contacts = await jmap(token, [CORE, CONTACTS], [[
    "ContactCard/get",
    { accountId: account, ids: null },
    "c0",
  ]]);
  const contactList = methodBody(contacts, "ContactCard/get").list ?? [];
  if (!containsDeep(contactList, manifest.contactName) || !containsDeep(contactList, manifest.contactEmail)) {
    fail("ContactCard/get lost the seeded contact", contactList);
  }

  const basic = { user: adminUser, pass: adminPass };
  const fileListing = await dav("PROPFIND", `/files/users/${adminUser}/`, {
    body: propfind,
    depth: "1",
    ...basic,
  });
  if (!String(fileListing).includes(manifest.fileName)) {
    fail("WebDAV PROPFIND lost the drive file", fileListing);
  }
  const downloaded = await dav("GET", `/files/users/${adminUser}/${manifest.fileName}`, basic);
  if (String(downloaded) !== manifest.fileBody) {
    fail("WebDAV GET bytes do not match the seeded file", downloaded);
  }

  const calendarHome = await dav("PROPFIND", `/calendars/${adminUser}/`, {
    body: propfind,
    depth: "1",
    ...basic,
  });
  if (!String(calendarHome).includes("/calendars/")) {
    fail("CalDAV PROPFIND did not list the calendar home", calendarHome);
  }
  const calendarData = await dav("REPORT", `/calendars/${adminUser}/default/`, {
    body: calendarReport,
    depth: "1",
    ...basic,
  });
  if (!String(calendarData).includes(manifest.eventTitle)) {
    fail("CalDAV REPORT lost the seeded event", calendarData);
  }

  const bookHome = await dav("PROPFIND", `/addressbooks/${adminUser}/`, {
    body: propfind,
    depth: "1",
    ...basic,
  });
  if (!String(bookHome).includes("/addressbooks/")) {
    fail("CardDAV PROPFIND did not list the address book home", bookHome);
  }
  const cardData = await dav("REPORT", `/addressbooks/${adminUser}/default/`, {
    body: addressbookReport,
    depth: "1",
    ...basic,
  });
  if (!String(cardData).includes(manifest.contactName)) {
    fail("CardDAV REPORT lost the seeded contact", cardData);
  }

  console.log("Upgrade data integrity checks passed");
}

if (!base) {
  fail("WGW_UPGRADE_BASE_URL is required");
}
if (mode === "seed") {
  await seed();
} else if (mode === "verify") {
  await verify();
} else {
  fail("usage: node tools/upgrade-e2e/integrity.mjs seed|verify");
}
