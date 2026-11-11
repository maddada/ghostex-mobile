/**
 * When the one Live Activity starts, updates and ends, from the content state the app
 * builds on every summary refresh (`contentState.ts`). The adapter is ActivityKit behind the native module in
 * the app, and a fake in the tests.
 *
 * - Start: while the setting is on, every computer with agents sends start times and the attention kind, an agent
 *   works or waits, none runs and the app is in front: ActivityKit starts an activity only for an app in front (a
 *   background run for a push updates and ends one, but starts none), so an agent read in the background starts it
 *   at the first refresh in front. A start iOS refuses is asked for again in the app's next stretch in front, or when
 *   a working stint begins, not on every refresh. An activity that ended outside the app (the
 *   user removed it, or iOS ended it after 8 hours) is not started again on the next refresh; the next working
 *   stint that begins starts a new one: a working agent whose session or `workingStartedAt` the last
 *   refresh did not have, among all working agents, also those without a row and the same session's next turn.
 * - Update: when the content changed, and once a minute while the data stays fresh, so its stale date moves
 *   on while the app runs. No update carries an alert or a sound.
 * - End: 15 minutes after the last agent stopped working or waiting, and at once when the
 *   setting is switched off or a computer with agents sends no start times or attention kind (no wrong
 *   values, so no activity until that Mac is updated).
 *
 * Kept free of React Native so it is testable under `bun test`.
 */

import type { LiveActivityContentState } from './contentState';

/** What reaches ActivityKit. There is deliberately no alert configuration: the notification carries it. */
export type ActivityContent = {
  state: LiveActivityContentState;
  /** Epoch ms after which the system marks the content as outdated. */
  staleDate: number;
};

export type LiveActivityAdapter = {
  /** Whether an activity is on the Lock Screen or in the Dynamic Island; null while an earlier call is still running. */
  hasActivity: () => boolean | null;
  request: (content: ActivityContent) => Promise<void>;
  update: (content: ActivityContent) => Promise<void>;
  end: () => Promise<void>;
};

export type ActivityTimers<Handle> = {
  readonly setTimeout: (run: () => void, ms: number) => Handle;
  readonly clearTimeout: (handle: Handle) => void;
};

export type ActivityControllerDeps<Handle> = {
  readonly adapter: LiveActivityAdapter;
  readonly now: () => number;
  readonly timers: ActivityTimers<Handle>;
  /** A failed ActivityKit call, for the app log. */
  readonly onError: (message: string) => void;
  /**
   * How long after its data time the content counts as outdated; `STALE_AFTER_MS` when not given. Longer while a
   * computer keeps the activity updated while the phone is locked (`liveActivityPushState.ts`).
   */
  readonly staleAfterMs?: () => number;
};

export type ActivityController = {
  /**
   * Applies the latest content; `workingStints` the keys of every working agent (`workingStints` in
   * `contentState.ts`), `enabled` the Settings switch (`liveActivityEnabled`), `hostsCurrent` false while any
   * computer with agents sends no start times or attention kind (`computersNeedingUpdate`), `inFront` whether the
   * app is in front (active) now. Called again when `inFront` changes, so a start that waited for the front, or
   * that iOS refused in an earlier stretch in front, is asked for then.
   */
  process: (
    state: LiveActivityContentState,
    workingStints: readonly string[],
    enabled: boolean,
    hostsCurrent: boolean,
    inFront: boolean,
  ) => void;
};

/** The activity ends this long after the last agent stopped working or waiting. */
export const END_AFTER_IDLE_MS = 15 * 60_000;
/**
 * The content counts as outdated this long after its data time: long enough
 * that a refresh or two that fail on the way do not flag it, short enough that a suspended app is visible.
 */
export const STALE_AFTER_MS = 2 * 60_000;
/** While the data stays fresh but unchanged, the stale date is moved on this often. */
export const STALE_REFRESH_MS = 60_000;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The content without its data time, to tell a changed content from a newer read of the same one. */
function shapeOf(state: LiveActivityContentState): string {
  return JSON.stringify({ ...state, updatedAt: '' });
}

export function createActivityController<Handle>(deps: ActivityControllerDeps<Handle>): ActivityController {
  const { adapter, timers } = deps;
  /** The app has an activity it started and did not end. */
  let running = adapter.hasActivity() === true;
  /** An activity ended outside the app: wait for the next agent that starts working. */
  let held = false;
  /** The app's stretches in front, counted as `process` sees them. */
  let frontStretch = 0;
  let wasInFront = false;
  /** The stretch in front in which iOS refused the last start: no start is asked for again in it. */
  let refusedIn: number | null = null;
  let idleSince: number | null = null;
  let endTimer: Handle | null = null;
  /** `workingStints` of the last refresh. */
  let knownStints = new Set<string>();
  let sentShape: string | null = null;
  let sentDataTime = 0;

  const clearEndTimer = (): void => {
    if (endTimer === null) return;
    timers.clearTimeout(endTimer);
    endTimer = null;
  };

  const endActivity = (reason: string): void => {
    clearEndTimer();
    idleSince = null;
    running = false;
    sentShape = null;
    adapter
      .end()
      .catch((error: unknown) => deps.onError(`Live Activity: ending it (${reason}) failed: ${errorText(error)}`));
  };

  const contentFor = (state: LiveActivityContentState): ActivityContent => ({
    state,
    staleDate: Date.parse(state.updatedAt) + (deps.staleAfterMs?.() ?? STALE_AFTER_MS),
  });

  const remember = (state: LiveActivityContentState, shape: string): void => {
    sentShape = shape;
    sentDataTime = Date.parse(state.updatedAt);
  };

  return {
    process: (state, workingStints, enabled, hostsCurrent, inFront) => {
      if (inFront && !wasInFront) frontStretch += 1;
      wasInFront = inFront;

      if (!enabled || !hostsCurrent) {
        const reason = enabled ? 'a computer needs a Ghostex update' : 'switched off in Settings';
        if (running || adapter.hasActivity() === true) endActivity(reason);
        held = false;
        refusedIn = null;
        knownStints = new Set();
        return;
      }

      if (running && adapter.hasActivity() === false) {
        // Ended outside the app: the user removed it, or iOS ended it after its 8 hours.
        running = false;
        held = true;
        sentShape = null;
        clearEndTimer();
        idleSince = null;
      }

      // A working stint began: a working agent whose session and stint start the last refresh did not have.
      const stints = new Set(workingStints);
      const stintStarted = [...stints].some((stint) => !knownStints.has(stint));
      knownStints = stints;
      if (stintStarted) {
        held = false;
        refusedIn = null;
      }

      const active = state.counts.working + state.counts.waiting > 0;
      if (!running) {
        if (!active || held || !inFront || refusedIn === frontStretch) return;
        running = true;
        idleSince = null;
        remember(state, shapeOf(state));
        const stretch = frontStretch;
        adapter.request(contentFor(state)).catch((error: unknown) => {
          // Not the user removing it: asked for again in the next stretch in front, or for the next working stint.
          running = false;
          refusedIn = stretch;
          sentShape = null;
          deps.onError(`Live Activity: starting it failed: ${errorText(error)}`);
        });
        return;
      }

      const now = deps.now();
      if (active) {
        idleSince = null;
        clearEndTimer();
      } else if (idleSince === null) {
        idleSince = now;
        endTimer = timers.setTimeout(() => {
          endTimer = null;
          if (running) endActivity('15 minutes without a working or waiting agent');
        }, END_AFTER_IDLE_MS);
      } else if (now - idleSince >= END_AFTER_IDLE_MS) {
        // The timer could not fire while iOS suspended the app.
        endActivity('15 minutes without a working or waiting agent');
        return;
      }

      const shape = shapeOf(state);
      const dataTime = Date.parse(state.updatedAt);
      if (shape === sentShape && dataTime - sentDataTime < STALE_REFRESH_MS) return;
      remember(state, shape);
      adapter.update(contentFor(state)).catch((error: unknown) => {
        sentShape = null;
        deps.onError(`Live Activity: updating it failed: ${errorText(error)}`);
      });
    },
  };
}
