const TUNNELED_HTTP_METHODS = new Set(["PUT", "PATCH", "DELETE"]);

/**
 * Some Apache/nginx frontends redirect PUT/PATCH/DELETE with 301/302, which browsers
 * follow as GET. Tunnel through POST + Symfony/Laravel method override instead.
 */
export function tunnelMutatingHttpMethod(init: RequestInit): RequestInit {
  const method = (init.method ?? "GET").toUpperCase();
  if (!TUNNELED_HTTP_METHODS.has(method)) {
    return init;
  }

  const headers = new Headers(init.headers);
  headers.set("X-HTTP-Method-Override", method);

  return { ...init, method: "POST", headers };
}
