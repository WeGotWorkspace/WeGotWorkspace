/** Read a short error message from a WGW API error response body. */
export function wgwLooksLikeHtml(body: string): boolean {
  const head = body.trimStart().slice(0, 240).toLowerCase();
  return (
    head.startsWith("<!doctype") ||
    head.startsWith("<html") ||
    head.startsWith("<br") ||
    head.includes("<b>warning</b>")
  );
}

export function parseApiErrorJson(
  body: string,
): { error?: unknown; message?: unknown; code?: unknown } | null {
  try {
    return JSON.parse(body) as { error?: unknown; message?: unknown; code?: unknown };
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return null;
    }
    try {
      return JSON.parse(body.slice(start, end + 1)) as {
        error?: unknown;
        message?: unknown;
        code?: unknown;
      };
    } catch {
      return null;
    }
  }
}

export function wgwErrorMessageFromBody(body: string, status: number, statusText = ""): string {
  const fallback = statusText.trim() || `HTTP ${status}`;
  const trimmed = body.trim();
  if (!trimmed) {
    return fallback;
  }
  const json = parseApiErrorJson(trimmed);
  if (json) {
    const candidate =
      typeof json.error === "string"
        ? json.error
        : typeof json.message === "string"
          ? json.message
          : typeof json.code === "string"
            ? json.code
            : null;
    if (candidate?.trim()) {
      return candidate.trim();
    }
  }
  return fallback;
}

export function wgwReadJsonFailureMessage(body: string, status: number): string {
  const fromJson = wgwErrorMessageFromBody(body, status);
  if (fromJson && fromJson !== `HTTP ${status}` && fromJson !== "OK") {
    return fromJson;
  }
  if (wgwLooksLikeHtml(body)) {
    return "Server returned HTML instead of a result";
  }
  return `Server returned a non-JSON response (${status})`;
}

export async function wgwReadJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    const extracted = parseApiErrorJson(text);
    if (extracted) return extracted;
    throw new Error(wgwReadJsonFailureMessage(text, res.status));
  }
}
