import type { DriveShareSessionResponse } from "@wgw-api-generated/drive-types";
import { wgwApiBaseUrl, wgwErrorMessageFromBody } from "@/lib/api/wgw/http";

export class ShareSessionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ShareSessionError";
  }
}

function shareSessionErrorFromResponse(
  body: string,
  status: number,
  statusText: string,
): ShareSessionError {
  let code: string | undefined;
  const message = wgwErrorMessageFromBody(body, status, statusText);
  const trimmed = body.trim();
  if (trimmed) {
    try {
      const json = JSON.parse(trimmed) as { code?: unknown };
      if (typeof json.code === "string" && json.code.trim()) {
        code = json.code.trim();
      }
    } catch {
      // Non-JSON bodies fall back to status-only handling.
    }
  }
  return new ShareSessionError(message, status, code);
}

export async function createDriveShareSession(
  token: string,
  password?: string | null,
  signal?: AbortSignal,
): Promise<DriveShareSessionResponse> {
  const base = wgwApiBaseUrl();
  const res = await fetch(`${base}/files/share-sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token,
      ...(password ? { password } : {}),
    }),
    signal,
  });
  const body = await res.text();
  if (!res.ok) {
    throw shareSessionErrorFromResponse(body, res.status, res.statusText);
  }
  return JSON.parse(body) as DriveShareSessionResponse;
}
