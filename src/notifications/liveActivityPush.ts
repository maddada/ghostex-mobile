/**
 * Hands the phone's Live Activity tokens to its one banner computer (`liveActivityPick.ts`), so the Lock Screen
 * banner stays current while the phone is locked: that computer builds the banner for itself and the computers
 * connected to it and sends it through Ghostex's push relay. Each pass (`sync`):
 *
 * 1. Asks each enabled computer whose endpoint lists `liveActivityPush` for its status
 *    (`registerLiveActivity {action: 'status'}`: its server id, the computers it can read, whether it holds this
 *    phone's tokens and pushes with them), at most once a minute per computer unless a pass needs it now.
 * 2. Picks the banner computer.
 * 3. Clears the tokens on every other computer that holds them or that this launch registered with, first,
 *    so no two computers ever push this phone's banner.
 * 4. Registers with the pick when it does not hold exactly what is wanted now (the tokens, the build's push
 *    environment, "Show session names", the phone's ids for its other computers), or holds it without
 *    pushing (a computer that restarted or slept waits for the phone to confirm it).
 *
 * Off (the Live Activity switch, its "Keep it updated while locked" switch, or no token from iOS yet): the pass
 * clears the tokens everywhere they are and registers nowhere. The app's own updates of its activity, while it
 * runs, do not depend on any of this: a computer without the capability, a refusal or no answer leaves the
 * banner exactly as before, updated while the app is open.
 *
 * Passes never overlap; one asked for during a pass runs after it. A computer that did not answer is asked again
 * at the next pass (the app comes to the front, the computers' lists, the settings or the tokens change). Tokens
 * are send credentials: they go only to the computers' warm link, and no log line carries one.
 *
 * Kept free of React Native so it is testable under `bun test`.
 */

import { pickBannerComputer, type PickComputer } from './liveActivityPick';

/** The tokens iOS issued: the running activity's update token and the app's push-to-start token (hex). */
export type LiveActivityTokens = { update?: string; start?: string };

export type LiveActivityEnvironment = 'production' | 'sandbox';

export type LiveActivityParams =
  | { action: 'status'; machineId: string }
  | { action: 'clear'; machineId: string }
  | {
      action: 'register';
      machineId: string;
      activityToken?: string;
      pushToStartToken?: string;
      environment: LiveActivityEnvironment;
      sessionNames: boolean;
      computers: { serverId: string; machineId: string }[];
    };

/** What a computer answered: its status (also the answer to a register or clear), or why it did not. */
export type LiveActivityAnswer =
  | { ok: true; serverId: string; speaksFor: string[]; holds: boolean; confirmed: boolean }
  | { ok: false; reason: 'unreachable' | 'unsupported' | 'refused' };

export type LiveActivityPushDeps = {
  /** The Live Activity switch and its "Keep it updated while locked" switch both on (and iOS). */
  enabled(): boolean;
  tokens(): LiveActivityTokens;
  environment(): LiveActivityEnvironment;
  sessionNames(): boolean;
  /** The enabled computers, by the phone's own id for each. */
  machines(): readonly { id: string }[];
  /** Its endpoint lists `liveActivityPush` (true), does not (false), or its link knows no endpoint yet (null). */
  capable(machineId: string): boolean | null;
  /** It answered its last session list read. */
  answered(machineId: string): boolean;
  /** It has a working or waiting agent. */
  active(machineId: string): boolean;
  send(machineId: string, params: LiveActivityParams): Promise<LiveActivityAnswer>;
  now(): number;
  log(message: string): void;
};

/** A computer's status is read again after this long, or at once when a pass needs it. */
export const STATUS_MAX_AGE_MS = 60_000;

type Status = { serverId: string; speaksFor: string[]; holds: boolean; confirmed: boolean; at: number };

export class LiveActivityPushRegistration {
  private readonly deps: LiveActivityPushDeps;
  private readonly statuses = new Map<string, Status>();
  /** Computers this launch registered with (a clear must reach them even if their status was not read). */
  private readonly registeredWith = new Set<string>();
  /** What the holder took last, to tell a change. */
  private sent: { machineId: string; signature: string } | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private lastLog = '';

  constructor(deps: LiveActivityPushDeps) {
    this.deps = deps;
  }

  /** Runs a pass now, or once more after the one running. */
  sync(): Promise<void> {
    if (this.running !== null) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.pass();
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  /**
   * The computer is being removed from the phone: it is asked to stop pushing and forget the tokens (its answer is
   * not waited for longer than `waitMs`), and the next pass picks among the others.
   */
  async removing(machineId: string, waitMs: number): Promise<void> {
    const cleared = this.deps.send(machineId, { action: 'clear', machineId }).catch(() => null);
    await Promise.race([cleared, new Promise((resolve) => setTimeout(resolve, waitMs))]);
    this.statuses.delete(machineId);
    this.registeredWith.delete(machineId);
    if (this.sent?.machineId === machineId) this.sent = null;
  }

  /** The computer that holds the tokens as far as the phone knows (for Settings and the logs). */
  holder(): string | null {
    return this.sent?.machineId ?? null;
  }

  private log(message: string): void {
    if (message === this.lastLog) return;
    this.lastLog = message;
    this.deps.log(message);
  }

  private remember(machineId: string, answer: LiveActivityAnswer): boolean {
    if (!answer.ok) {
      this.statuses.delete(machineId);
      return false;
    }
    this.statuses.set(machineId, {
      serverId: answer.serverId,
      speaksFor: answer.speaksFor,
      holds: answer.holds,
      confirmed: answer.confirmed,
      at: this.deps.now(),
    });
    return true;
  }

  /** Reads the status of each computer not read within `maxAgeMs`. */
  private async readStatuses(capable: readonly string[], maxAgeMs: number): Promise<void> {
    const now = this.deps.now();
    await Promise.all(
      capable
        .filter((machineId) => {
          const known = this.statuses.get(machineId);
          return known === undefined || now - known.at >= maxAgeMs;
        })
        .map(async (machineId) => {
          this.remember(machineId, await this.deps.send(machineId, { action: 'status', machineId }));
        }),
    );
  }

  private async clear(machineId: string): Promise<boolean> {
    const answer = await this.deps.send(machineId, { action: 'clear', machineId });
    if (answer.ok) {
      this.remember(machineId, answer);
      this.registeredWith.delete(machineId);
      if (this.sent?.machineId === machineId) this.sent = null;
      return true;
    }
    this.log(`Live Activity: ${machineId} could not be asked to stop pushing (${answer.reason})`);
    return false;
  }

  private async pass(): Promise<void> {
    const machines = this.deps.machines().map((machine) => machine.id);
    const capable = machines.filter((machineId) => this.deps.capable(machineId) === true);
    const tokens = this.deps.tokens();
    const on = this.deps.enabled() && (tokens.update !== undefined || tokens.start !== undefined);
    // Off, each computer is asked once per launch, to find tokens an earlier launch left there.
    await this.readStatuses(capable, on ? STATUS_MAX_AGE_MS : Number.POSITIVE_INFINITY);
    const holders = new Set<string>([
      ...this.registeredWith,
      ...[...this.statuses].filter(([, status]) => status.holds).map(([machineId]) => machineId),
    ]);
    if (!on) {
      for (const machineId of holders) await this.clear(machineId);
      return;
    }

    const computers: PickComputer[] = machines.flatMap((machineId) => {
      const status = this.statuses.get(machineId);
      if (status === undefined) return [];
      return [
        {
          machineId,
          serverId: status.serverId,
          answered: this.deps.answered(machineId),
          capable: this.deps.capable(machineId) === true,
          active: this.deps.active(machineId),
          speaksFor: status.speaksFor,
        },
      ];
    });
    const current = this.sent?.machineId ?? [...holders][0] ?? null;
    const pick = pickBannerComputer(computers, current);
    if (pick === null) return;

    // Never two: every other holder stops first.
    for (const machineId of holders) {
      if (machineId !== pick) await this.clear(machineId);
    }

    const params: LiveActivityParams = {
      action: 'register',
      machineId: pick,
      ...(tokens.update === undefined ? {} : { activityToken: tokens.update }),
      ...(tokens.start === undefined ? {} : { pushToStartToken: tokens.start }),
      environment: this.deps.environment(),
      sessionNames: this.deps.sessionNames(),
      computers: computers
        .filter((computer) => computer.machineId !== pick)
        .map((computer) => ({ serverId: computer.serverId, machineId: computer.machineId })),
    };
    const signature = JSON.stringify(params);
    const status = this.statuses.get(pick);
    const holdsWanted =
      this.sent?.machineId === pick && this.sent.signature === signature && status?.holds === true && status.confirmed;
    if (holdsWanted) return;
    const answer = await this.deps.send(pick, params);
    if (this.remember(pick, answer)) {
      this.registeredWith.add(pick);
      this.sent = { machineId: pick, signature };
      this.log(`Live Activity: ${pick} keeps the Live Activity updated while the phone is locked`);
    } else if (!answer.ok) {
      this.log(`Live Activity: ${pick} did not take the Live Activity (${answer.reason})`);
    }
  }
}
