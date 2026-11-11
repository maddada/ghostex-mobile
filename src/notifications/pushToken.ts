/**
 * The phone's Expo push token on its computers. With iOS's permission, the master switch on and a build that
 * has a push project (the EAS project id), the app fetches the token and registers it with every enabled
 * computer over the existing authenticated warm link (`registerPushToken`, `{action: 'register', token, machineId,
 * kinds, deviceId?}`); `machineId` is the phone's own id for that computer (its `MachineRecord.id`), which the
 * computer keeps with the token and returns as `data.machineId` in every push, so the phone knows which computer a
 * push comes from. `kinds` are the finished, waiting and error switches: the computer pushes no kind that is off.
 * `deviceId` is the pairing device id of a computer paired by QR code (none for one added by SSH), so unpairing the
 * phone on that computer can delete its token; a pairing id the route does not take is left out (logged, without
 * the id), so the computer still takes the token, but unpairing there cannot find it. A computer keeps one token
 * per phone, under that phone's `machineId`, and replaces it at that phone's next registration. With the master
 * switch off the app asks each enabled computer to remove it (`{action: 'unregister', machineId}`), so no push
 * leaves the computers; turned on again, it registers again.
 *
 * Each pass (`sync`) runs at an occasion: the app starts or returns, the master switch, the finished, waiting or
 * error switch or the permission changes, a computer is added, shown again or paired anew (`tokenChanged`: iOS
 * issued a new token). A computer that took exactly what is wanted now (token, switches, pairing id) is not asked
 * again; one that did not take a request is asked again at the next occasion, never in a loop, so a switch change
 * that does not reach a computer takes effect there at the next registration it takes. A computer whose Ghostex does
 * not know the route has no push, and one the phone reaches only on the exec route cannot be asked: neither is asked
 * again (also not for a switch change) until the app starts again or the token changes. Push is offered only by a
 * computer whose `ghostex server endpoint` lists `pushNotifications`: one that does not gets no registration
 * (`noPush`), counts as one whose pushes the app does not count on, and is looked at again at the next occasion, so
 * it is registered once its Ghostex offers push; a removal (master switch off, removing the computer) still goes to
 * it, because an earlier registration may still be there. What the computer's link already knows (`offersPush`) is
 * read before the caches that skip a computer (one without push or on the exec route, one holding what is wanted),
 * so one whose endpoint stops listing the flag during the launch (a reconnect settles a new one) leaves at the next
 * occasion without being asked; a link that knows no endpoint yet says nothing. With the master switch off at launch,
 * each enabled computer is asked once to remove the token,
 * because an earlier launch may have registered it. What the person or iOS changed during a pass wins: a token
 * fetched before iOS issued a newer one is never kept
 * or sent, and before each request the pass checks that the master switch and the token still ask for it, once more
 * when the computer's route is known, right before the request is handed to the link (`send`, `superseded`); if
 * not, it stops and the pass that follows sends what is wanted now. A switch change during a pass gets the pass that
 * follows, which sends the switches as they are then to each computer that took others. A request already handed to
 * the link is not called back: what the computer answered is kept, and the following pass corrects it, except for a
 * computer whose removal started (below).
 *
 * Removing a computer (`removing`, while its saved record still exists): once the first ask was answered (before it
 * this phone never registered), the app first asks that computer, hidden or not, to remove the token, whatever the
 * master switch and the phone's token say now, because an earlier registration may still be there. The removal
 * names this phone's `machineId`, so it removes this phone's token only. The removal waits for the answer at most
 * `REMOVAL_WAIT_MS`; then the computer is removed anyway: one that did not take the removal keeps the token, and
 * nothing asks it again on its own (a second Remove the person confirms during the wait asks again, and the screen
 * removes it again). From the start of its removal, for the rest of the launch, no pass sends that computer anything
 * and none corrects it: a registration a pass handed to the link before can still reach it after the removal, and
 * then it keeps the token. When removing it on the phone fails after the removal went out, it stays saved but gets
 * no registration until the app starts again.
 *
 * The app learns what each computer confirmed (`accepted`): it took the token (true), or it holds none (false: it
 * removed the token, or its Ghostex has no push route); a computer that does not offer push is counted as false as
 * well, since the app counts on the pushes of a computer that offers push only. Anything else confirms nothing,
 * because a computer keeps the token it holds until it takes a new registration or a removal: a refused request,
 * an answer the phone cannot read,
 * a computer out of reach or on the exec route. What it took before then stays as the app knew it; the app keeps
 * that across launches (`setPushAccepted` in `eventIdentity.ts`), ids only. A computer the app never heard confirm
 * is not counted as holding the token, also when a request went out and its answer was lost.
 *
 * The token is a send credential: it is kept in memory only, goes nowhere but the computers' warm link, and no
 * log line carries it. Kept free of React Native so it is testable under `bun test`.
 */

import type { PermissionState } from './firstAsk';
import { ALERT_KIND_KEYS, type AlertChoices, type NotificationSettings } from './settings';

/** The finished, waiting and error switches as a registration carries them: the computer pushes no kind that is off. */
export type PushKinds = { finished: boolean; waiting: boolean; error: boolean };

/** One request of the `registerPushToken` route; each names the computer by the phone's own id for it. */
export type PushTokenParams =
  | {
      action: 'register';
      token: string;
      machineId: string;
      kinds: PushKinds;
      deviceId?: string;
      /** The "Show session names" switch, sent only to a computer that lists `pushSessionNames`. */
      sessionNames?: boolean;
      /** Sound, Silent or Off for each kind, sent only to a computer that lists `pushAlertChoices`. */
      alerts?: AlertChoices;
    }
  | { action: 'unregister'; machineId: string };

/**
 * How a computer answered: it took the request; its Ghostex does not know the route (`unsupported`); the phone
 * reaches it only on the exec route, without its gxserver's API (`legacy`); it could not be reached; it did not
 * take the request (`refused`: it refused it, or its answer could not be read); or the request was not sent,
 * because the master switch or the token changed while it was prepared (`superseded`), or because it is a
 * registration and the computer's `ghostex server endpoint` does not list `pushNotifications` (`noPush`).
 */
export type PushTokenSendOutcome =
  | 'done'
  | 'unsupported'
  | 'legacy'
  | 'unreachable'
  | 'refused'
  | 'superseded'
  | 'noPush';

export type PushTokenDeps = {
  /** iOS's notification permission now. */
  permission(): Promise<PermissionState>;
  settings(): NotificationSettings;
  /** The build's push project (EAS project id); null when the build has none. */
  projectId(): string | null;
  /** Fetches the Expo push token for the project; rejects when iOS or Expo give none. */
  obtainToken(projectId: string): Promise<string>;
  /**
   * The enabled computers, by the phone's own id for each (`MachineRecord.id`), with the pairing device id of one
   * paired by QR code.
   */
  machines(): readonly { id: string; label: string; deviceId?: string }[];
  /**
   * What the computer's warm link knows about push without a request: true when its endpoint lists
   * `pushNotifications`, false when it does not, null when the link has settled no endpoint (no absence).
   */
  offersPush(machineId: string): boolean | null;
  /** Whether the computer's endpoint lists `pushSessionNames` (it takes `sessionNames`); false while unknown. */
  offersSessionNames(machineId: string): boolean;
  /** The "Show session names" switch: on, the computer's pushes lead with the session's title. */
  sessionNames(): boolean;
  /** Whether the computer's endpoint lists `pushAlertChoices` (it takes `alerts`); false while unknown. */
  offersAlertChoices(machineId: string): boolean;
  /**
   * One request to a computer's gxserver over the warm link; `current` tells whether the pass still wants it sent,
   * checked right before it is handed to the link.
   */
  send(machineId: string, params: PushTokenParams, current: () => boolean): Promise<PushTokenSendOutcome>;
  /** A computer confirmed that it holds this phone's token (true) or that it holds none (false). */
  accepted(machineId: string, holds: boolean): void;
  log(message: string): void;
  /** A timer of `ms`: `expired` resolves when it ran out; `cancel` stops it. */
  startTimer(ms: number): { expired: Promise<void>; cancel(): void };
  /** Whether the app is in front (a retry after a failed registration runs only then). */
  inFront(): boolean;
};

/**
 * How long after a registration a computer did not take the next tries wait, while the app stays in front: three
 * spaced tries, then the usual occasions (the app comes back to the front, a switch or the computers change).
 */
export const REGISTRATION_RETRY_DELAYS_MS: readonly number[] = [5_000, 15_000, 45_000];

/** How long removing a computer waits for its answer to the removal of the token. */
export const REMOVAL_WAIT_MS = 2_000;

/** An Expo push token as the computer accepts it (the registration's schema). */
const EXPO_PUSH_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,64}\]$/u;

/** Whether two registrations carry the same choices (both none, or the same choice for every kind). */
function sameChoices(a: AlertChoices | undefined, b: AlertChoices | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return ALERT_KIND_KEYS.every((key) => a[key] === b[key]);
}

/** A pairing device id as the computer accepts it (the registration's schema): 1 to 128 visible ASCII characters. */
const DEVICE_ID = /^[\x21-\x7e]{1,128}$/u;

/** Whether a computer that took `taken` holds what `wanted` asks for: the same token, switches and pairing id. */
function holdsAlready(taken: PushTokenParams, wanted: PushTokenParams): boolean {
  if (taken.action === 'unregister' || wanted.action === 'unregister') return taken.action === wanted.action;
  return (
    taken.token === wanted.token &&
    taken.deviceId === wanted.deviceId &&
    taken.sessionNames === wanted.sessionNames &&
    sameChoices(taken.alerts, wanted.alerts) &&
    taken.kinds.finished === wanted.kinds.finished &&
    taken.kinds.waiting === wanted.kinds.waiting &&
    taken.kinds.error === wanted.kinds.error
  );
}

export class PushTokenRegistration {
  private token: string | null = null;
  /** How often iOS issued a new token: a fetch that began before the latest issue is stale. */
  private tokenIssues = 0;
  /** iOS's device token from its last announcement (`tokenChanged`); it stays here, never in the log. */
  private deviceToken: string | null = null;
  /** Whether a token fetch is in flight: the announcement it causes is not a new issue. */
  private fetching = false;
  /** Per enabled computer, the request it took last in this launch: a registration, or the removal. */
  private readonly taken = new Map<string, PushTokenParams>();
  /** Computers that have no push or cannot be asked, until the app starts again or the token changes. */
  private readonly unsupported = new Set<string>();
  /** Computers the person removes in this launch, from the start of their removal: no pass sends them anything. */
  private readonly removed = new Set<string>();
  private toldNoProject = false;
  private running: Promise<void> | null = null;
  private again: Promise<void> | null = null;
  /** The retry waiting after a registration a computer did not take, and how many tries this run of them made. */
  private retry: { cancel(): void } | null = null;
  private retries = 0;
  private retrying = false;

  constructor(private readonly deps: PushTokenDeps) {}

  /** One pass now; an occasion during a pass gets one more pass after it, shared by every such occasion. */
  sync(): Promise<void> {
    // An occasion starts a fresh run of retries; a retry's own pass keeps counting.
    if (!this.retrying) this.retries = 0;
    this.retrying = false;
    if (this.running === null) {
      this.running = this.pass().finally(() => {
        this.running = null;
      });
      return this.running;
    }
    this.again ??= this.running.then(() => {
      this.again = null;
      return this.sync();
    });
    return this.again;
  }

  /**
   * iOS issued a new token: it is fetched anew and goes to every computer, those without push included.
   * `deviceToken` is iOS's own token from the event; one the phone already saw is no new token.
   */
  tokenChanged(deviceToken?: string): Promise<void> {
    /*
    CDXC:Notifications 2026-11-10 WHY:
    iOS announces the device token after every registration, also the one each token fetch makes itself, so every
    fetch counted as a new issue: the token it got was dropped as stale and the next pass fetched again, a loop of
    fetches and permission reads (about every 280 ms, also in the background) that never registered a token with any
    computer (11.3.0, no push at all). Only a device token that differs from the last one seen is a new issue; the
    first one seen during a fetch is the one that fetch gets.
    */
    if (deviceToken !== undefined) {
      const previous = this.deviceToken;
      this.deviceToken = deviceToken;
      if (deviceToken === previous || (previous === null && this.fetching)) return Promise.resolve();
    }
    this.token = null;
    this.tokenIssues += 1;
    this.unsupported.clear();
    return this.sync();
  }

  /** Whether removing a computer asks it to remove the token: once the first ask was answered, as `removing` does. */
  asksOnRemoval(): boolean {
    // Before the first ask was answered this phone never registered.
    return this.deps.settings().askedAt !== undefined;
  }

  /**
   * The person removes `machine` (hidden or not) and its saved record still exists: when `asksOnRemoval`, the
   * computer is asked once to remove the token. Resolves with its answer, or when `REMOVAL_WAIT_MS` ran out; never
   * throws. Nothing asks it again unless the person removes it again, and no pass sends it anything for the rest of
   * the launch.
   */
  async removing(machine: { id: string; label: string }): Promise<void> {
    this.removed.add(machine.id);
    if (!this.asksOnRemoval()) return;
    const timer = this.deps.startTimer(REMOVAL_WAIT_MS);
    let waiting = true;
    const answer = this.deps
      .send(machine.id, { action: 'unregister', machineId: machine.id }, () => waiting)
      .catch((): PushTokenSendOutcome => 'unreachable');
    const outcome = await Promise.race([answer, timer.expired.then(() => null)]);
    // A request not yet handed to the link is not sent once the removal stopped waiting; a later answer is moot.
    waiting = false;
    timer.cancel();
    if (outcome === null) {
      const seconds = REMOVAL_WAIT_MS / 1000;
      this.deps.log(
        `${machine.label}: no answer to the push token removal within ${seconds} s; the computer may keep it`,
      );
    } else if (outcome === 'done' || outcome === 'unsupported') {
      this.deps.accepted(machine.id, false);
      this.deps.log(`${machine.label}: push token ${outcome === 'done' ? 'removed' : 'removal not needed (no push)'}`);
    } else {
      this.deps.log(`${machine.label}: push token removal not taken (${outcome}); the computer may keep it`);
    }
  }

  private async pass(): Promise<void> {
    const machines = this.deps.machines();
    const enabled = new Set(machines.map((machine) => machine.id));
    // A hidden or removed computer gets the token again when it is shown again.
    for (const id of [...this.taken.keys()]) if (!enabled.has(id)) this.taken.delete(id);
    const wanted = await this.wantedToken();
    if (wanted === undefined) return;
    let notTaken: string | null = null;
    for (const machine of machines) {
      if (this.removed.has(machine.id)) continue;
      const params = this.request(machine, wanted);
      // Before the caches below: they would keep a computer that took the token before its endpoint stopped listing
      // the flag. Read locally, so a computer on the exec route is not asked again.
      if (params.action === 'register' && this.deps.offersPush(machine.id) === false) {
        this.offersNoPush(machine);
        continue;
      }
      if (this.unsupported.has(machine.id)) continue;
      const taken = this.taken.get(machine.id);
      if (taken !== undefined && holdsAlready(taken, params)) continue;
      if (!this.deps.machines().some((entry) => entry.id === machine.id)) continue;
      if (!this.stillWanted(wanted)) {
        // The master switch or the token changed meanwhile: the pass that follows sends what is wanted now.
        void this.sync();
        return;
      }
      const outcome = await this.deps
        .send(machine.id, params, () => this.stillWanted(wanted) && !this.removed.has(machine.id))
        .catch((): PushTokenSendOutcome => 'unreachable');
      if (outcome === 'superseded') {
        void this.sync();
        return;
      }
      // Its removal started meanwhile: what it answered to this request goes with it.
      if (this.removed.has(machine.id)) continue;
      if (outcome === 'noPush') {
        this.offersNoPush(machine);
        continue;
      }
      if (params.action === 'register' && params.deviceId === undefined && (machine.deviceId ?? '').length > 0) {
        // The id itself stays out of the log: it is pairing metadata, not something the log needs.
        this.deps.log(
          `${machine.label}: pairing id left out of the push token registration (not one the computer takes)`,
        );
      }
      const what = wanted === null ? 'removal' : 'registration';
      if (outcome === 'done') {
        this.taken.set(machine.id, params);
        this.deps.accepted(machine.id, wanted !== null);
        this.deps.log(
          wanted === null
            ? `${machine.label}: push token removed`
            : `Push: ${machine.label} registered this phone's push token; its notifications reach the phone`,
        );
      } else if (outcome === 'unsupported' || outcome === 'legacy') {
        this.unsupported.add(machine.id);
        // Only a Ghostex that answered it knows no push route surely holds no token.
        if (outcome === 'unsupported') this.deps.accepted(machine.id, false);
        this.deps.log(`${machine.label}: this computer has no push yet; not asked again until the app starts again`);
      } else {
        // Not taken: the computer keeps what it held before, so nothing is confirmed.
        if (params.action === 'register') notTaken ??= machine.label;
        const next = params.action === 'register' ? this.nextRetryMs() : null;
        this.deps.log(
          next === null
            ? `${machine.label}: push token ${what} not taken (${outcome}); asked again at the next occasion`
            : `${machine.label}: push token ${what} not taken (${outcome}); trying again in ${next / 1000} s`,
        );
      }
    }
    if (notTaken !== null) this.scheduleRetry();
  }

  /** The wait before the next retry, or null when this run of retries is spent. */
  private nextRetryMs(): number | null {
    return REGISTRATION_RETRY_DELAYS_MS[this.retries] ?? null;
  }

  /**
   * CDXC:Notifications 2026-11-11 WHY: a computer that did not take the registration (its link not ready yet right
   * after pairing, or its answer lost) was asked again only at the next occasion, so a phone that paired and stayed
   * open got no push until it left the front and came back. A few spaced tries follow while the app stays in front;
   * each is a whole pass, so it also reaches any other computer that did not take it.
   */
  private scheduleRetry(): void {
    const delay = this.nextRetryMs();
    if (delay === null || this.retry !== null) return;
    this.retries += 1;
    const timer = this.deps.startTimer(delay);
    this.retry = timer;
    void timer.expired.then(() => {
      if (this.retry !== timer) return;
      this.retry = null;
      // Out of the front, coming back is the next occasion.
      if (!this.deps.inFront()) return;
      this.retrying = true;
      void this.sync();
    });
  }

  /**
   * `machine` does not offer push: no registration, and it counts as holding none. Not kept as without push: a removal
   * still goes to it, the next occasion looks again, and what it took before is sent anew once it offers push.
   */
  private offersNoPush(machine: { id: string; label: string }): void {
    this.taken.delete(machine.id);
    this.deps.accepted(machine.id, false);
    this.deps.log(`${machine.label}: this computer does not offer push; no push token registered`);
  }

  /**
   * What `machine` is asked for now: the registration of `wanted` with the switches as they are now and its pairing
   * device id when the route takes it (an empty one is none; one it does not take is left out), or the removal
   * (`wanted` null).
   */
  private request(machine: { id: string; deviceId?: string }, wanted: string | null): PushTokenParams {
    if (wanted === null) return { action: 'unregister', machineId: machine.id };
    const { finished, waiting, error } = this.deps.settings();
    const deviceId = machine.deviceId ?? '';
    return {
      action: 'register',
      token: wanted,
      machineId: machine.id,
      kinds: { finished, waiting, error },
      ...(DEVICE_ID.test(deviceId) ? { deviceId } : {}),
      /*
      CDXC:Notifications 2026-11-11 DECISION: the computer builds the push, so it learns the "Show session names"
      switch with the registration: off (the default), its pushes lead with the agent's name; on, with the session's
      title, like the Live Activity and the widgets. A computer whose endpoint does not list `pushSessionNames` refuses
      the field and never puts a session title in a push, so it is not sent there.
      */
      ...(this.deps.offersSessionNames(machine.id) ? { sessionNames: this.deps.sessionNames() } : {}),
      /*
      CDXC:Notifications 2026-11-11 DECISION: the computer learns the Sound, Silent or Off choice of each kind with
      the registration, so it sends nothing the phone would drop and a Silent kind without its sound; a thread's
      turn under a coordinator reaches the phone only where its choice is not Off. A computer whose endpoint does not
      list `pushAlertChoices` refuses the field and keeps the finished, waiting and error switches (`kinds`).
      */
      ...(this.deps.offersAlertChoices(machine.id) ? { alerts: { ...this.deps.settings().choices } } : {}),
    };
  }

  /** Whether the master switch and the phone's token still ask each computer to hold `wanted`. */
  private stillWanted(wanted: string | null): boolean {
    const settings = this.deps.settings();
    if (settings.askedAt === undefined) return false;
    if (!settings.enabled) return wanted === null;
    return wanted !== null && wanted === this.token;
  }

  /**
   * The token each computer should hold: the phone's (master switch on, permission, push project), null (master
   * switch off after the first ask: none), or undefined when nothing is to be sent now.
   */
  private async wantedToken(): Promise<string | null | undefined> {
    const settings = this.deps.settings();
    // Before the first ask was answered this phone never registered.
    if (settings.askedAt === undefined) return undefined;
    if (!settings.enabled) return null;
    if ((await this.deps.permission()) !== 'granted') return undefined;
    if (this.token !== null) return this.token;
    const projectId = this.deps.projectId();
    if (projectId === null) {
      if (!this.toldNoProject) this.deps.log('Push: this build has no push project; push notifications stay off');
      this.toldNoProject = true;
      return undefined;
    }
    const issued = this.tokenIssues;
    this.fetching = true;
    try {
      const token = await this.deps.obtainToken(projectId);
      if (!EXPO_PUSH_TOKEN.test(token)) throw new TokenFetchError('notAnExpoPushToken');
      // iOS issued a newer token while this one was fetched: the pass that issue asked for fetches that one.
      if (issued !== this.tokenIssues) return undefined;
      this.token = token;
      return token;
    } catch (error) {
      // iOS's or Expo's own error text stays out of the app log (it can carry the token); its code says why.
      this.deps.log(`Push: no push token this time (${tokenFetchFailure(error)}); asked again at the next occasion`);
      return undefined;
    } finally {
      this.fetching = false;
    }
  }
}

class TokenFetchError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/**
 * Why a token fetch failed, fit for the app log: the error's code (Expo's `ERR_NOTIFICATIONS_…`, iOS's registration
 * code) and, for an answer Expo refused, its HTTP status; never the message, which can quote the token.
 */
export function tokenFetchFailure(error: unknown): string {
  const record = typeof error === 'object' && error !== null ? (error as { code?: unknown; message?: unknown }) : {};
  const code = typeof record.code === 'string' && /^[A-Za-z0-9_.-]{1,64}$/u.test(record.code) ? record.code : null;
  const message = typeof record.message === 'string' ? record.message : '';
  const status = /expected an OK response, received: (\d{3})\b/u.exec(message)?.[1];
  const name = error instanceof Error && /^[A-Za-z]{1,40}$/u.test(error.name) ? error.name : 'unexpected';
  return [code ?? name, status === undefined ? null : `HTTP ${status}`].filter(Boolean).join(', ');
}
