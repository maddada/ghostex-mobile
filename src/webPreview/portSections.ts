import type { RemoteListeningPort } from './ports';

export type PortSectionId = 'pages' | 'tools' | 'services' | 'other';
export type PortListRow = {
  entry: RemoteListeningPort;
  title: string;
  description: string;
  address: string;
  section: PortSectionId;
};

export const PORT_SECTIONS: { id: PortSectionId; title: string; description: string }[] = [
  { id: 'pages', title: 'Web pages', description: 'Pages responding on your computer' },
  { id: 'tools', title: 'Development tools', description: 'Storybook, dev servers, and development tools' },
  { id: 'services', title: 'Services', description: 'APIs, databases, and background services' },
  { id: 'other', title: 'Other ports', description: 'Listeners without an identified web page' },
];

const COMMON_TOOLS: Record<number, string> = {
  6006: 'Storybook', 6007: 'Storybook', 5173: 'Vite', 5174: 'Vite',
  4173: 'Vite preview', 8081: 'Metro', 9222: 'Browser debugger', 9229: 'Node debugger',
};
const COMMON_SERVICES: Record<number, string> = {
  22: 'SSH', 53: 'DNS', 631: 'Printing', 3306: 'MySQL', 5432: 'PostgreSQL',
  6379: 'Redis', 27017: 'MongoDB', 11211: 'Memcached',
};
const SERVICES: [RegExp, string][] = [
  [/sshd/i, 'SSH'], [/postgres/i, 'PostgreSQL'], [/mysqld|mariadbd/i, 'MySQL'],
  [/redis/i, 'Redis'], [/mongod/i, 'MongoDB'], [/cupsd/i, 'Printing'],
  [/gxserver|ghostex/i, 'Ghostex service'], [/rapportd/i, 'Apple device communication'],
  [/controlce/i, 'macOS Control Center'], [/sharingd/i, 'Apple sharing'],
  [/tailscale/i, 'Tailscale'], [/ollama/i, 'Ollama'],
];

/**
 * CDXC:Browser 2026-09-12 DECISION:
 * User: organize the mobile browser list into collapsible sections with page information and recognizable labels, including Storybook on 6006.
 * Port numbers alone are hints; a title or process name supplies the actual identification.
 */
export function describePort(entry: RemoteListeningPort): PortListRow {
  const web = entry.web;
  const identity = `${web?.title ?? ''} ${entry.command ?? ''}`;
  const tool = /storybook/i.test(identity) ? 'Storybook'
    : /vite/i.test(identity) ? 'Vite'
    : /webpack/i.test(identity) ? 'Webpack'
    : /next-server|next\.js/i.test(identity) ? 'Next.js'
    : /metro/i.test(identity) ? 'Metro'
    : null;
  const service = SERVICES.find(([pattern]) => pattern.test(entry.command ?? ''))?.[1];
  const likelyTool = COMMON_TOOLS[entry.port];
  const likelyService = COMMON_SERVICES[entry.port];
  const page = web?.kind === 'page' && web.status < 400;
  const section: PortSectionId = tool ? 'tools' : page ? 'pages'
    : service ? 'services' : likelyTool ? 'tools'
    : web !== null || likelyService ? 'services' : 'other';
  const title = web?.title ?? tool ?? service
    ?? (likelyTool ? `${likelyTool} (likely)` : likelyService ? `${likelyService} (likely)` : null)
    ?? (page ? 'Untitled web page' : web ? 'HTTP service' : entry.command ?? 'Unidentified listener');
  const details = [
    tool ?? service ?? (page ? 'Web page' : (likelyTool || likelyService) && !web?.title ? 'Suggested by port number' : null),
    web ? `HTTP ${web.status}` : 'Page not identified',
    web?.server,
  ].filter(Boolean);
  return {
    entry, title, section, description: details.join(' · '),
    address: `${web?.scheme ?? 'http'}://localhost:${entry.port}`,
  };
}

export function groupPorts(ports: RemoteListeningPort[], query: string) {
  const search = query.trim().toLowerCase();
  const rows = ports.map(describePort).filter((row) =>
    [row.title, row.description, row.address, row.entry.command, row.entry.pid, ...row.entry.addresses]
      .join(' ').toLowerCase().includes(search));
  return PORT_SECTIONS.map((section) => ({
    ...section,
    rows: rows.filter((row) => row.section === section.id)
      .sort((left, right) => left.title.localeCompare(right.title) || left.entry.port - right.entry.port),
  })).filter((section) => section.rows.length > 0);
}
