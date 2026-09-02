/**
 * Where an http(s) link belongs. A link to the phone's own loopback is never
 * what the user meant: the listener is on the computer, so the address has to
 * be opened through a forward in the Web preview rather than handed to the
 * phone's browser. Everything else keeps going to the system browser.
 */

import { isLoopbackHost, parseHttpUrl } from './urls';

export type WebPreviewTarget = {
  /** Port on the computer, as written in the link. */
  remotePort: number;
  /** Path + query, always starting with `/`. */
  path: string;
  scheme: 'http' | 'https';
};

/** The preview target for a link, or `null` when it is not a loopback link. */
export function webPreviewTargetForUrl(url: string): WebPreviewTarget | null {
  const parsed = parseHttpUrl(url);
  if (parsed === null || !isLoopbackHost(parsed.host)) return null;
  return { remotePort: parsed.port, path: parsed.pathAndQuery, scheme: parsed.scheme };
}
