/**
 * URL translation for the Web preview.
 *
 * A preview always loads `http://127.0.0.1:<localPort>/…` on the phone, but the
 * user only ever thinks in the computer's own addresses, so every string shown
 * to them is rebuilt as `localhost:<remotePort>/…`. Both directions are pure
 * string work here; the (remotePort ↔ localPort) table itself belongs to the
 * screen that owns the live forwards.
 *
 * Parsing is done by hand rather than with `URL`, because React Native's `URL`
 * is a partial implementation that does not expose a usable `port`/`hostname`
 * split for every shape we get from `onShouldStartLoadWithRequest`.
 */

/** The phone-side address a forward listens on. */
export const LOOPBACK_HOST = '127.0.0.1';

/**
 * Hosts that mean "this machine" to a web app. `0.0.0.0` is a bind address
 * rather than a destination, but dev servers print it and pages link to it, and
 * on the computer it resolves to the same listener a forward reaches.
 */
const LOOPBACK_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
  // IPv4-mapped loopback: what a dual-stack server prints for 127.0.0.1.
  '[::ffff:127.0.0.1]',
]);

const DEFAULT_PORT_BY_SCHEME: Record<string, number> = { http: 80, https: 443 };

export type ParsedHttpUrl = {
  /** Lowercased, without the trailing colon. */
  scheme: 'http' | 'https';
  /** Lowercased host, brackets kept for IPv6 literals. */
  host: string;
  /** The scheme's default port when the URL carried none. */
  port: number;
  /** Everything from the path onwards, always starting with `/`. */
  pathAndQuery: string;
};

const HTTP_URL_PATTERN = /^(https?):\/\/([^/?#]*)([^]*)$/i;

/** Parse an absolute http(s) URL into the parts the preview needs. */
export function parseHttpUrl(url: string): ParsedHttpUrl | null {
  const match = HTTP_URL_PATTERN.exec(url.trim());
  if (match === null) return null;
  const scheme = match[1].toLowerCase() as 'http' | 'https';
  const authority = match[2];
  const rest = match[3];
  /*
   * A backslash is not a legal authority character, and WebKit and Chromium
   * disagree about whether they normalize it to "/" before or after the host
   * ends. Refusing the URL outright means neither engine can be talked into
   * treating "http://localhost\@evil.example/" as loopback here.
   */
  if (authority.includes('\\')) return null;
  // Strip userinfo: everything up to and including the last "@".
  const atIndex = authority.lastIndexOf('@');
  const hostAndPort = atIndex < 0 ? authority : authority.slice(atIndex + 1);
  if (hostAndPort.length === 0) return null;

  let host = hostAndPort;
  let portText = '';
  if (hostAndPort.startsWith('[')) {
    const closing = hostAndPort.indexOf(']');
    if (closing < 0) return null;
    host = hostAndPort.slice(0, closing + 1);
    const tail = hostAndPort.slice(closing + 1);
    if (tail.length > 0) {
      if (!tail.startsWith(':')) return null;
      portText = tail.slice(1);
    }
  } else {
    const colon = hostAndPort.lastIndexOf(':');
    if (colon >= 0) {
      host = hostAndPort.slice(0, colon);
      portText = hostAndPort.slice(colon + 1);
    }
  }

  let port = DEFAULT_PORT_BY_SCHEME[scheme];
  if (portText.length > 0) {
    if (!/^\d+$/.test(portText)) return null;
    const parsed = Number.parseInt(portText, 10);
    if (!isValidPort(parsed)) return null;
    port = parsed;
  }

  return {
    scheme,
    // A fully qualified "localhost." resolves to the same host; the trailing
    // root label is dropped so it is recognised as loopback rather than as an
    // ordinary web address.
    host: (host.endsWith('.') && !host.endsWith(']') ? host.slice(0, -1) : host).toLowerCase(),
    port,
    pathAndQuery: rest.length === 0 || !rest.startsWith('/') ? `/${rest}` : rest,
  };
}

/** Whether a parsed host names the machine the page is served from. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** Parse a typed port; `null` when it is not a usable TCP port. */
export function parsePortInput(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const port = Number.parseInt(trimmed, 10);
  return isValidPort(port) ? port : null;
}

/** The phone-side URL a forward serves. */
export function localPreviewUrl(scheme: 'http' | 'https', localPort: number, pathAndQuery: string): string {
  return `${scheme}://${LOOPBACK_HOST}:${localPort}${pathAndQuery}`;
}

/**
 * What the same page is at on the computer. The scheme is dropped because the
 * address bar has room for one line and `localhost:3000/path` is what the user
 * would type there.
 */
export function remoteDisplayAddress(remotePort: number, pathAndQuery: string): string {
  const path = pathAndQuery === '/' ? '/' : pathAndQuery;
  return `localhost:${remotePort}${path}`;
}
