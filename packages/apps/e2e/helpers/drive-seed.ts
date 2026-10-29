import { E2E_PASSWORD, E2E_USERNAME } from "./notes-live";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";

/**
 * Put a file on the drive over WebDAV as the e2e user.
 * `/api/v1/files/content` is read-only (GET/HEAD); the app itself writes through JMAP FileNode.
 */
export async function putDriveFile(
  apiPath: string,
  content: string,
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
