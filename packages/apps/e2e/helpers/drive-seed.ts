import { E2E_PASSWORD, E2E_USERNAME } from "./notes-live";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";

/**
 * Put a file on the drive over WebDAV as the e2e user.
 * `/api/v1/files/content` is read-only (GET/HEAD); the app itself writes through JMAP FileNode.
 */
export async function putDriveFile(
  apiPath: string,
  content: string | Uint8Array,
  contentType: string,
): Promise<void> {
  const encoded = apiPath
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const response = await fetch(`${API}/files/${encoded}`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${Buffer.from(`${E2E_USERNAME}:${E2E_PASSWORD}`).toString("base64")}`,
      "Content-Type": contentType,
    },
    body: content,
  });
  if (!response.ok) {
    throw new Error(`Seed ${apiPath} failed (${response.status}): ${await response.text()}`);
  }
}

/** Rename or move a drive file over WebDAV `MOVE`, as another client would. */
export async function moveDriveFile(fromApiPath: string, toApiPath: string): Promise<void> {
  const davUrl = (apiPath: string) =>
    `${API}/files/${apiPath
      .replace(/^\/+/, "")
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;
  const response = await fetch(davUrl(fromApiPath), {
    method: "MOVE",
    headers: {
      Authorization: `Basic ${Buffer.from(`${E2E_USERNAME}:${E2E_PASSWORD}`).toString("base64")}`,
      Destination: davUrl(toApiPath),
      Overwrite: "F",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Move ${fromApiPath} → ${toApiPath} failed (${response.status}): ${await response.text()}`,
    );
  }
}

/** Delete a drive file over WebDAV `DELETE`, as another client would. */
export async function deleteDriveFile(apiPath: string): Promise<void> {
  const encoded = apiPath
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const response = await fetch(`${API}/files/${encoded}`, {
    method: "DELETE",
    headers: {
      Authorization: `Basic ${Buffer.from(`${E2E_USERNAME}:${E2E_PASSWORD}`).toString("base64")}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Delete ${apiPath} failed (${response.status}): ${await response.text()}`);
  }
}

/**
 * Create a folder of small text files over WebDAV as the e2e user, eight at a time.
 * Retries a 429, so seeding many files never fails on the request budget.
 */
export async function seedDriveFolder(folderApiPath: string, fileNames: string[]): Promise<void> {
  const url = (apiPath: string) =>
    `${API}/files/${apiPath
      .replace(/^\/+/, "")
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;
  const send = async (method: string, apiPath: string, body?: string) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await fetch(url(apiPath), {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${E2E_USERNAME}:${E2E_PASSWORD}`).toString("base64")}`,
          ...(body === undefined ? {} : { "Content-Type": "text/plain" }),
        },
        body,
      });
      if (response.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      // 405 on MKCOL: the folder exists already (a retried run).
      if (!response.ok && !(method === "MKCOL" && response.status === 405)) {
        throw new Error(`${method} ${apiPath} failed (${response.status})`);
      }
      return;
    }
    throw new Error(`${method} ${apiPath} stayed rate limited`);
  };
  await send("MKCOL", `${folderApiPath}/`);
  for (let at = 0; at < fileNames.length; at += 8) {
    await Promise.all(
      fileNames
        .slice(at, at + 8)
        .map((name) => send("PUT", `${folderApiPath}/${name}`, `seeded ${name}\n`)),
    );
  }
}
