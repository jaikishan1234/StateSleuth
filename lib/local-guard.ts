/**
 * Practical local-only guard for the code-application endpoints.
 *
 * This is NOT authentication. It is a heuristic that makes the file-writing
 * endpoints refuse requests that did not arrive addressed to this machine:
 * the Host header, any X-Forwarded-For hop, and any Origin must all be
 * loopback. Combined with binding the server to 127.0.0.1, it keeps a
 * single-user local demo from being driven remotely by accident.
 *
 * Limitations (deliberate, documented rather than hidden):
 * - A non-browser client fully controls its own headers and can forge a
 *   loopback Host/Origin.
 * - Requests forwarded by a reverse proxy are judged on X-Forwarded-For, so a
 *   misconfigured proxy can defeat the check.
 * - The real protection is the bind address: run with `-H 127.0.0.1`.
 *
 * Server-only: call this from route handlers.
 */

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"]);

export type LocalGuardResult = { ok: true } | { ok: false; reason: string };

/** Strips brackets and an optional port from a Host or URL hostname. */
function normalizeHostname(raw: string): string {
  let value = raw.trim().toLowerCase();
  if (value.length === 0) return "";

  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end === -1 ? value : value.slice(1, end);
  }

  const firstColon = value.indexOf(":");
  const lastColon = value.lastIndexOf(":");
  // Exactly one colon means "host:port". No colon means "host". Several
  // colons means a bare IPv6 literal, which has no port to strip.
  if (firstColon !== -1 && firstColon === lastColon) {
    value = value.slice(0, lastColon);
  }

  return value;
}

/**
 * True when a hostname (with or without a port, or bracketed IPv6) is
 * loopback. Exported so the verification runner can apply the same rule to the
 * origin it is asked to drive.
 */
export function isLoopbackHostname(raw: string): boolean {
  const hostname = normalizeHostname(raw);
  if (hostname.length === 0) return false;
  if (LOOPBACK_HOSTNAMES.has(hostname)) return true;
  // 127.0.0.0/8 is entirely loopback.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

/**
 * True when the request is addressed to this machine from a loopback origin.
 *
 * Returns a human-readable reason on refusal; the reason contains no request
 * data beyond the header kind, so it is safe to show.
 */
export function checkLocalRequest(request: Request): LocalGuardResult {
  const host = request.headers.get("host");
  if (!host) {
    return { ok: false, reason: "Code approval requires a Host header addressed to localhost." };
  }
  if (!isLoopbackHostname(host)) {
    return {
      ok: false,
      reason: "Code approval is only available from localhost. Start the server with -H 127.0.0.1.",
    };
  }

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const firstHop = forwarded.split(",")[0] ?? "";
    if (!isLoopbackHostname(firstHop)) {
      return {
        ok: false,
        reason: "Code approval is only available from a loopback client address.",
      };
    }
  }

  const origin = request.headers.get("origin");
  if (origin) {
    let hostname: string;
    try {
      hostname = new URL(origin).hostname;
    } catch {
      return { ok: false, reason: "The Origin header could not be parsed." };
    }
    if (!isLoopbackHostname(hostname)) {
      return { ok: false, reason: "Cross-origin code approval is refused." };
    }
  }

  return { ok: true };
}