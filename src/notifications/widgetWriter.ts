/**
 * Writes the widget snapshot (`widgetSnapshot.ts`) into the App Group container after a session refresh and asks
 * WidgetKit to reload the widgets' timelines, once per write. Without a background push the widgets show what the
 * app last wrote; their data time says how old that is.
 *
 * - A refresh that changes nothing the widgets show writes nothing: the snapshot is compared without the seconds
 *   of its data time, which the widgets show to the minute. While the poll runs, an unchanged state is written
 *   again once a minute, so the data time stays current.
 * - Before any summary was read nothing is written (the widgets keep what they have); with no computer saved any
 *   more the snapshot is deleted.
 * - Usage: the selected computer's accounts (`agentAccounts`, the usage pane's read) are read at most every 2 minutes
 *   per computer, also across switching computers, and only while the summary poll runs: the computer answers from a
 *   reading of up to 2 minutes anyway, so a faster read brings nothing new. A reading older than 5 minutes, or of
 *   another computer, is not written; the large widget then shows no bars.
 *
 * Kept free of React Native so the rules are testable under `bun test`; `widgets.ts` wires it to the stores.
 */

import type { UsageBar } from '../usage/usageMeters';
import type { ActivitySource } from './contentState';
import { buildSnapshot } from './widgetSnapshot';

export const USAGE_READ_EVERY_MS = 120_000;
export const USAGE_MAX_AGE_MS = 300_000;

/** The App Group file and WidgetKit (`modules/ghostex-widgets`). */
export type WidgetHost = {
  write: (json: string) => Promise<void>;
  remove: () => Promise<void>;
  reloadTimelines: () => void;
};

export type WidgetInputs = {
  /** False once the last computer was removed. */
  computersSaved: boolean;
  /** The enabled computers' summaries that were read. */
  sources: readonly ActivitySource[];
  selectedMachineId: string | null;
  /** Whether the summary poll runs (the app in the foreground with a computer selected). */
  polling: boolean;
  /** The Settings switch (`liveActivitySessionNames`): the agents lead with their sessions' names. */
  showSessionNames: boolean;
};

export type WidgetWriterDeps = {
  host: WidgetHost;
  now: () => number;
  /** The selected computer's usage bars (`buildUsageBars` over its `agentAccounts` answer). */
  readUsageBars: (machineId: string) => Promise<readonly UsageBar[]>;
  onError: (message: string) => void;
};

export type WidgetWriter = {
  /**
   * Brings the snapshot in line with `inputs`. Resolves once the write it queued is done and, when it started a
   * usage read, once that read and the write it leads to are done.
   */
  sync: (inputs: WidgetInputs) => Promise<void>;
};

/** The last write deleted the snapshot. */
const REMOVED = 'removed';

export function createWidgetWriter(deps: WidgetWriterDeps): WidgetWriter {
  /** The last written state (`REMOVED` after a delete); null before the first write or after a failed one. */
  let lastShown: string | null = null;
  /** Native calls run one after another. */
  let queue: Promise<void> = Promise.resolve();
  /** Per computer: its last usage reading and its last read, so switching back within 2 minutes reads nothing. */
  const usage = new Map<string, { readAt: number; bars: readonly UsageBar[] }>();
  const usageReads = new Map<string, { startedAt: number; done: boolean }>();
  let lastInputs: WidgetInputs | null = null;

  const run = (shown: string, call: () => Promise<void>): Promise<void> => {
    lastShown = shown;
    queue = queue
      .then(call)
      .then(() => deps.host.reloadTimelines())
      .catch((error: unknown) => {
        // The next refresh writes again.
        lastShown = null;
        deps.onError(`widgets: ${error instanceof Error ? error.message : String(error)}`);
      });
    return queue;
  };

  const write = (inputs: WidgetInputs): Promise<void> => {
    if (!inputs.computersSaved) {
      return lastShown === REMOVED ? queue : run(REMOVED, () => deps.host.remove());
    }
    if (inputs.sources.length === 0) return queue;
    const now = deps.now();
    const reading = inputs.selectedMachineId === null ? undefined : usage.get(inputs.selectedMachineId);
    const fresh = reading !== undefined && now - reading.readAt <= USAGE_MAX_AGE_MS;
    const snapshot = buildSnapshot(inputs.sources, now, fresh ? reading.bars : [], inputs.showSessionNames);
    const shown = JSON.stringify({ ...snapshot, writtenAt: snapshot.writtenAt.slice(0, 16) });
    if (shown === lastShown) return queue;
    const json = JSON.stringify(snapshot);
    return run(shown, () => deps.host.write(json));
  };

  /** Starts the selected computer's usage read when one is due; resolves after it and the write it leads to. */
  const readUsage = (inputs: WidgetInputs): Promise<void> => {
    const machineId = inputs.selectedMachineId;
    if (!inputs.polling || machineId === null) return Promise.resolve();
    const now = deps.now();
    const last = usageReads.get(machineId);
    if (last !== undefined && (!last.done || now - last.startedAt < USAGE_READ_EVERY_MS)) {
      return Promise.resolve();
    }
    const read = { startedAt: now, done: false };
    usageReads.set(machineId, read);
    return deps.readUsageBars(machineId).then(
      (bars) => {
        read.done = true;
        usage.set(machineId, { readAt: deps.now(), bars });
        return lastInputs === null ? Promise.resolve() : write(lastInputs);
      },
      (error: unknown) => {
        read.done = true;
        deps.onError(`widgets usage: ${error instanceof Error ? error.message : String(error)}`);
      },
    );
  };

  return {
    sync: (inputs) => {
      lastInputs = inputs;
      return Promise.all([write(inputs), readUsage(inputs)]).then(() => undefined);
    },
  };
}
