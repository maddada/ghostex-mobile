/**
 * In-memory demo experience. The session list, chats and terminal scripts start
 * from bundled fixtures and change only while the app is open. Removing the
 * demo machine resets them. Nothing here performs I/O.
 */

import type { ExecResult } from '../../modules/ghostex-native/src';

import { cliArguments } from '../remote/powershell';

import { DemoCopy } from './copy';
import { DEMO_PREVIEW_PORT } from './previewHtml';

export type DemoTurn = { id: string; role: 'user' | 'agent'; text: string };

type DemoSession = {
  sessionId: string;
  projectId: string;
  projectName: string;
  title: string;
  agent: string;
  agentName: string;
  activity: 'idle' | 'working' | 'attention';
  /** ISO time the current working stint began, when `activity` is `working`. */
  workingStartedAt: string;
  attention: boolean;
  pendingQuestion: boolean;
  /** Put to sleep (`ghostex sleep`) and not woken since: listed asleep, as a computer lists it. */
  sleeping?: boolean;
  messages: DemoTurn[];
  terminal: string[];
};

type DemoProject = { projectId: string; name: string; path: string };

const PROJECTS: readonly DemoProject[] = [
  { projectId: 'atlas', name: 'Atlas API', path: '~/code/atlas-api' },
  { projectId: 'side', name: 'Side project', path: '~/code/side-project' },
  { projectId: 'wander', name: 'Wander', path: '~/code/wander' },
];

const AGENTS = [
  { agentId: 'claude', icon: 'claude', name: 'Claude' },
  { agentId: 'codex', icon: 'codex', name: 'Codex' },
  { agentId: 'grok', icon: 'grok', name: 'Grok' },
] as const;

const NOW = '2026-11-07T15:40:00Z';

function turn(id: string, role: DemoTurn['role'], text: string): DemoTurn {
  return { id, role, text };
}

function initialSessions(): DemoSession[] {
  return [
    {
      sessionId: 'atlas-rate-limit',
      projectId: 'atlas',
      projectName: 'Atlas API',
      title: 'Rate limit the public API',
      agent: 'claude',
      agentName: 'Claude',
      activity: 'attention',
      workingStartedAt: '',
      attention: true,
      pendingQuestion: true,
      messages: [
        turn(
          'atlas-1',
          'user',
          'Add a token bucket in front of POST /v1/search so one key cannot stampede the index.',
        ),
        turn(
          'atlas-2',
          'agent',
          "I'll put the limiter in the gateway, keyed by the API key: 60 requests a minute, with a burst of 10. The handler returns 429 and a Retry-After header, and I'll add a test that fires 61 calls.\n\nDo you want the limit to reset on the wall clock, or on a sliding window?",
        ),
      ],
      terminal: [
        'demo@atlas:~/code/atlas-api $',
        'ls',
        'gateway  index  README.md',
        'demo@atlas:~/code/atlas-api $',
      ],
    },
    {
      sessionId: 'side-landing',
      projectId: 'side',
      projectName: 'Side project',
      title: 'Landing page copy',
      agent: 'codex',
      agentName: 'Codex',
      activity: 'working',
      workingStartedAt: '2026-11-07T15:36:00Z',
      attention: false,
      pendingQuestion: false,
      messages: [
        turn('side-1', 'user', 'Draft a headline for the side project landing page. Keep it plain.'),
        turn(
          'side-2',
          'agent',
          'Working on three lines that do not sound like a slogan. The one I like so far is "Ship the small thing." I am still checking it against the page we already have.',
        ),
      ],
      terminal: ['demo@side:~/code/side-project $', 'cat copy.md', 'Ship the small thing.', 'demo@side:~/code/side-project $'],
    },
    {
      sessionId: 'wander-lisbon',
      projectId: 'wander',
      projectName: 'Wander',
      title: 'A weekend in Lisbon',
      agent: 'grok',
      agentName: 'Grok',
      activity: 'idle',
      workingStartedAt: '',
      attention: false,
      pendingQuestion: false,
      messages: [
        turn('wander-1', 'user', 'Sketch a two-day walk that stays near tram 28.'),
        turn(
          'wander-2',
          'agent',
          'Day one is Alfama up to the castle before lunch, then down to the river. Day two is Estrela to LX Factory, with the tram only when the hill is steep. Both days stay under 8 km, and the notes file lists cafes that open before 9.',
        ),
      ],
      terminal: [
        'demo@wander:~/code/wander $',
        'ls',
        'NOTES.md  itinerary  photos',
        'demo@wander:~/code/wander $',
        'git status',
        'On branch main',
        'nothing to commit, working tree clean',
        'demo@wander:~/code/wander $',
      ],
    },
    {
      sessionId: 'wander-shell',
      projectId: 'wander',
      projectName: 'Wander',
      title: 'Terminal',
      agent: '',
      agentName: '',
      activity: 'idle',
      workingStartedAt: '',
      attention: false,
      pendingQuestion: false,
      messages: [],
      terminal: [
        'demo@wander:~/code/wander $',
        'ls',
        'NOTES.md  itinerary  photos',
        'demo@wander:~/code/wander $',
        'cat NOTES.md',
        'Tram 28 is a walk with a tram, not the other way around.',
        'demo@wander:~/code/wander $',
      ],
    },
  ];
}

let revision = 1;
let sessions = initialSessions();
let nextNumber = 1;

export function resetDemoWorld(): void {
  revision = 1;
  sessions = initialSessions();
  nextNumber = 1;
}

function bump(): void {
  revision += 1;
}

function projectOf(projectId: string): DemoProject | undefined {
  return PROJECTS.find((project) => project.projectId === projectId);
}

function sessionOf(sessionId: string): DemoSession | undefined {
  return sessions.find((session) => session.sessionId === sessionId);
}

export function demoTranscript(sessionId: string): readonly DemoTurn[] {
  return sessionOf(sessionId)?.messages ?? [];
}

export function demoProjectName(sessionId: string): string {
  return sessionOf(sessionId)?.projectName ?? 'this project';
}

export function demoTerminalScript(sessionId: string): readonly string[] {
  const session = sessionOf(sessionId);
  if (session !== undefined && session.terminal.length > 0) return session.terminal;
  const project = session?.projectName ?? 'demo';
  const folder = project.toLowerCase().replace(/\s+/g, '-');
  return [`demo@demo:~/code/${folder} $`, 'ls', 'README.md', `demo@demo:~/code/${folder} $`];
}

/** A local answer for a command typed into the demo terminal. */
export function demoTerminalAnswer(command: string): string {
  const line = command.trim();
  const lower = line.toLowerCase();
  if (lower.length === 0) return '';
  if (lower === 'ls') return 'NOTES.md  README.md  src';
  if (lower === 'pwd') return '/home/demo/code';
  if (lower.startsWith('git status')) return 'On branch main\nnothing to commit, working tree clean';
  if (lower.startsWith('git')) return 'Demo git: that command is replayed locally and does not touch a repository.';
  if (lower === 'help') return 'Demo shell. Try ls, pwd, or git status. Nothing runs on a computer.';
  return `Demo shell: "${line}" is not run. This terminal only replays a script.`;
}

function scriptedReply(session: DemoSession, userText: string): string {
  const project = session.projectName;
  const asked = userText.trim();
  const lower = asked.toLowerCase();
  if (lower.includes('test')) {
    return `I'll add a test in ${project} for that. It would call the same path twice, once inside the limit and once past it, and expect the second answer to be a 429. You wrote: "${asked}". No test is actually run in this demo.`;
  }
  if (lower.includes('window') || lower.includes('clock') || lower.includes('sliding')) {
    return `A sliding window fits ${project} better than a wall-clock reset, so a burst at the end of a minute cannot double up. I'll note that next to the limiter and leave the raw key out of the log.`;
  }
  if (/\b(hi|hello|hey)\b/u.test(lower)) {
    return `Hello. This is the sample agent for ${project}. Ask about the work in this session and I'll answer from the script saved in the app.`;
  }
  return `I'll take that on in ${project}. You asked: "${asked}". In this demo I don't call a model. I'd read the notes in the repo and sketch the change on a short branch, then show you the diff here.`;
}

/** Append the user's message and return the full scripted reply to stream. */
export function sendDemoMessage(sessionId: string, userText: string): string {
  const session = sessionOf(sessionId);
  const text = userText.trim();
  if (session === undefined || text.length === 0) {
    return "This demo session isn't in the demo experience anymore.";
  }
  const stamp = `${session.sessionId}-${session.messages.length + 1}`;
  session.messages = [...session.messages, turn(`${stamp}-user`, 'user', text)];
  const reply = scriptedReply(session, text);
  session.messages = [...session.messages, turn(`${stamp}-agent`, 'agent', reply)];
  session.activity = 'idle';
  session.attention = false;
  session.pendingQuestion = false;
  session.workingStartedAt = '';
  bump();
  return reply;
}

function agentById(agentId: string): (typeof AGENTS)[number] {
  return AGENTS.find((agent) => agent.agentId === agentId) ?? AGENTS[0];
}

function addSession(projectId: string, agentId: string, title: string): DemoSession {
  const project = projectOf(projectId) ?? PROJECTS[0];
  const agent = agentById(agentId);
  const session: DemoSession = {
    sessionId: `demo-${nextNumber}`,
    projectId: project.projectId,
    projectName: project.name,
    title,
    agent: agent.agentId,
    agentName: agent.name,
    activity: 'idle',
    workingStartedAt: '',
    attention: false,
    pendingQuestion: false,
    messages: [turn(`demo-${nextNumber}-welcome`, 'agent', DemoCopy.newSessionWelcome(project.name))],
    terminal: [],
  };
  nextNumber += 1;
  sessions = [session, ...sessions];
  bump();
  return session;
}

/**
 * A `ghostex` command as the CLI builders write it, split into its words (`cliArguments`, which decodes shellQuote's
 * `'"'"'` for an apostrophe): the verb, then its arguments. Null for anything else (a script), which then matches no
 * verb, so a title or other value can never be read as a verb or cut short.
 */
function parseCommand(command: string): { verb: string; args: string[] } | null {
  try {
    const [verb = '', ...args] = cliArguments(command.trim());
    return { verb, args };
  } catch {
    return null;
  }
}

/** A flag's value, written `--name=value` or `--name value`. */
function flag(args: readonly string[], name: string): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index] ?? '';
    if (word.startsWith(`--${name}=`)) return word.slice(name.length + 3).trim();
    if (word === `--${name}`) {
      const value = args[index + 1];
      return value === undefined || value.startsWith('--') ? null : value.trim();
    }
  }
  return null;
}

function ok(result: unknown): ExecResult {
  return { stdout: `${JSON.stringify(result)}\n`, stderr: '', exitCode: 0 };
}

function sessionWire(session: DemoSession): Record<string, unknown> {
  const attention = session.attention
    ? {
        enteredAt: NOW,
        acknowledged: false,
        eventId: `ev-${session.sessionId}`,
        kind: 'needsInput',
        workingStartedAt: '',
        notificationId: `note-${session.sessionId}`,
      }
    : undefined;
  return {
    sessionId: session.sessionId,
    projectId: session.projectId,
    provider: 'zmx',
    title: session.title,
    displayTitle: session.title,
    projectName: session.projectName,
    agent: session.agent,
    agentIcon: session.agent,
    agentName: session.agentName,
    activity: session.activity,
    status: session.sleeping === true ? 'sleep' : 'running',
    isLive: session.sleeping !== true,
    isSleeping: session.sleeping === true,
    lastActiveAt: NOW,
    updatedAt: NOW,
    workingStartedAt: session.workingStartedAt,
    pendingQuestionCount: session.pendingQuestion ? 1 : 0,
    awaitingAnswer: session.pendingQuestion,
    ...(attention === undefined ? {} : { attention }),
  };
}

/** The mobile summary, in the shape `parseMobileSummary` already reads. */
export function demoSummaryWire(): Record<string, unknown> {
  return {
    demoRevision: revision,
    sessions: sessions.map(sessionWire),
    projects: PROJECTS.map((project) => ({
      projectId: project.projectId,
      name: project.name,
      path: project.path,
    })),
    recentProjects: PROJECTS.map((project) => ({
      projectId: project.projectId,
      title: project.name,
      path: project.path,
      sessionCount: sessions.filter((session) => session.projectId === project.projectId).length,
    })),
    agents: AGENTS.map((agent) => ({ agentId: agent.agentId, icon: agent.icon, name: agent.name })),
    quickActionsByProject: {
      atlas: [
        {
          actionType: 'browser',
          commandId: 'atlas-preview',
          name: 'Open preview',
          url: `http://localhost:${DEMO_PREVIEW_PORT}/`,
        },
      ],
    },
    capabilities: { awaitingAnswer: true, attentionNotificationId: true, globalQuickActions: false },
    builtInFeaturesOff: ['voiceAgent'],
    sidebarSessionLinks: 'badge',
  };
}

/**
 * Answer one ghostex command locally. Unknown commands succeed with an empty
 * object so a menu the demo does not model cannot open a network path.
 */
export function execDemoCommand(command: string): ExecResult {
  if (command.includes('sessions --json --mobile-summary')) return ok(demoSummaryWire());
  if (command.includes('ports --json')) {
    return ok({
      ports: [
        {
          port: DEMO_PREVIEW_PORT,
          address: '127.0.0.1',
          command: 'atlas-preview',
          pid: 4102,
          web: { scheme: 'http', status: 200, kind: 'page', title: 'Atlas API', server: 'demo' },
        },
      ],
    });
  }
  if (command.includes('client-hello') || command.includes('client-view')) return ok({ ok: true });
  // Every other command by its verb, never by a word inside a value (a title that reads "create-agent").
  const parsed = parseCommand(command);
  const verb = parsed?.verb ?? '';
  const args = parsed?.args ?? [];
  if (verb === 'create-agent') {
    const positional = args[0];
    const agentId = positional !== undefined && !positional.startsWith('--') ? positional : 'claude';
    const projectId = flag(args, 'project-id') ?? 'atlas';
    const agent = agentById(agentId);
    const project = projectOf(projectId);
    const session = addSession(projectId, agent.agentId, `New ${agent.name} session`);
    if (project === undefined) session.projectName = 'Atlas API';
    return ok({ ok: true, session: { sessionId: session.sessionId } });
  }
  if (verb === 'create-session' || verb === 'run-action') {
    const projectId = flag(args, 'project-id') ?? 'atlas';
    const session = addSession(projectId, '', 'Terminal');
    session.agent = '';
    session.agentName = '';
    session.title = 'Terminal';
    session.messages = [];
    return ok({ ok: true, session: { sessionId: session.sessionId } });
  }
  const sessionId = flag(args, 'session-id');
  const session = sessionId === null ? undefined : sessionOf(sessionId);
  if (session === undefined) return ok({ ok: true });
  if (verb === 'rename-command' || verb === 'request-session-rename') {
    const title = flag(args, 'title');
    if (title !== null && title.length > 0) session.title = title;
    bump();
  } else if (verb === 'acknowledge-session-attention') {
    session.attention = false;
    session.pendingQuestion = false;
    if (session.activity === 'attention') session.activity = 'idle';
    bump();
  } else if (verb === 'kill') {
    sessions = sessions.filter((entry) => entry.sessionId !== session.sessionId);
    bump();
  } else if (verb === 'sleep') {
    session.activity = 'idle';
    session.sleeping = true;
    bump();
  } else if (verb === 'wake') {
    session.sleeping = false;
    bump();
  }
  return ok({ ok: true });
}
