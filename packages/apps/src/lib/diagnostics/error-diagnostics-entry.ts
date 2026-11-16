import type {
  ErrorDiagnosticSource,
  NewErrorDiagnostic,
} from "@/lib/diagnostics/error-diagnostics-store";

export const ERROR_DIAGNOSTIC_MESSAGE_MAX = 500;
export const ERROR_DIAGNOSTIC_STACK_MAX = 4_000;

export type ErrorDiagnosticContext = {
  pathname: string;
  build: string;
  userAgent: string;
  now: Date;
};

/**
 * A URL (scheme://… or a path starting with `/`) followed by a query string or a
 * fragment. The query and fragment end at whitespace, a quote or bracket, or just
 * before a stack frame's `:line:column`.
 */
const URL_WITH_QUERY_OR_FRAGMENT =
  /((?:\b[a-z][a-z0-9+.-]*:\/\/|\/)[^\s?#'"()<>`]*)[?#][^\s'"()<>`]*?(?=(?::\d+){1,2}(?=[\s'"()<>`]|$)|[\s'"()<>`]|$)/gi;

/** Drop the query string and fragment of every URL in the text: they can name files or carry tokens. */
export function scrubUrls(text: string): string {
  return text.replace(URL_WITH_QUERY_OR_FRAGMENT, "$1");
}

function cap(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function pathOnly(pathname: string): string {
  const cut = pathname.search(/[?#]/);
  return cut === -1 ? pathname : pathname.slice(0, cut);
}

function appFromPath(path: string): string {
  const segment = path.split("/").find((part) => part.length > 0);
  return segment ?? "home";
}

/**
 * What an error reveals, by its shape only: name, message and stack of an Error,
 * the text of a thrown string. Other values are named by type, so a rejected
 * response or request body never lands in the buffer.
 */
function describeThrown(error: unknown): { name: string; message: string; stack: string } {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: String(error.message),
      stack: typeof error.stack === "string" ? error.stack : "",
    };
  }
  if (typeof error === "string") {
    return { name: "NonError", message: error, stack: "" };
  }
  const kind = error === null ? "null" : typeof error;
  return {
    name: "NonError",
    message: `A promise was rejected with a non-error value (${kind}).`,
    stack: "",
  };
}

export function buildErrorDiagnostic(
  error: unknown,
  source: ErrorDiagnosticSource,
  context: ErrorDiagnosticContext,
): NewErrorDiagnostic {
  const thrown = describeThrown(error);
  const route = pathOnly(context.pathname);
  return {
    time: context.now.toISOString(),
    source,
    name: cap(thrown.name, 100),
    message: cap(scrubUrls(thrown.message), ERROR_DIAGNOSTIC_MESSAGE_MAX),
    stack: cap(scrubUrls(thrown.stack), ERROR_DIAGNOSTIC_STACK_MAX),
    app: appFromPath(route),
    route,
    build: context.build,
    userAgent: context.userAgent,
  };
}
