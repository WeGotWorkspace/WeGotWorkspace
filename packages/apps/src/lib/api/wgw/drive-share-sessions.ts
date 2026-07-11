import type { DriveShareSessionResponse } from "@wgw-api-generated/drive-types";
import { wgwApiBaseUrl, wgwErrorMessageFromBody } from "@/lib/api/wgw/http";

export class ShareSessionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ShareSessionError";
  }
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
    throw new ShareSessionError(
      wgwErrorMessageFromBody(body, res.status, res.statusText),
      res.status,
    );
  }
  return JSON.parse(body) as DriveShareSessionResponse;
}
