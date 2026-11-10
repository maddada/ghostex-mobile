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
 * - "Show session names" switched off takes the names out of the widgets also when no summary is there to rebuild
 *   the rows from (the computers cannot be reached, or the app just started): a snapshot that may carry names is then
 *   deleted, and the next summary writes it again. The app cannot read the file back, so the host keeps a record of
 *   whether it may carry names, across launches; a snapshot written without names is never deleted for this. A
 *   record that could not be read is "unknown": it counts as "may carry names" for deleting, but not as stored, so
 *   a write with names still stores the record first and does not happen when that fails.
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

/**
 * What is known of the record, kept across launches, of whether the snapshot in the App Group may carry session
 * names: `names`, it is stored that it may; `none`, it is stored (or was never stored) that it carries none;
 * `unknown`, the record could not be read, so the file may carry names but nothing says so in storage.
 */
export type NamesRecord = 'names' | 'none' | 'unknown';

/** The App Group file and WidgetKit (`modules/ghostex-widgets`). */
export type WidgetHost = {
  write: (json: string) => Promise<void>;
  remove: () => Promise<void>;
  reloadTimelines: () => void;
  /** The record as it is known now. */
  namesRecord: () => NamesRecord;
  /** Stores the record; resolves once it is stored, after which `namesRecord` is `names` or `none`. */
  rememberNames: (mayHold: boolean) => Promise<void>;
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
  /** The last call queued may put names into the file (a write with session names shown). */
  let namesQueued = false;

  /**
   * Queues one native call. `names`: the call writes a snapshot built with session names shown. Unless the record
   * is known to be stored as `names`, it is stored before such a write, also when it is `unknown`, and a failure
   * to store it stops the write; it is cleared only after a write or delete without names went through. So
   * whatever fails or is cut short, a file that carries names always has `names` in storage.
   */
  const run = (shown: string, names: boolean, call: () => Promise<void>): Promise<void> => {
    lastShown = shown;
    namesQueued = names;
    queue = queue
      .then(() => (names && deps.host.namesRecord() !== 'names' ? deps.host.rememberNames(true) : undefined))
      .then(call)
      .then(() => deps.host.reloadTimelines())
      .then(() => (!names && deps.host.namesRecord() !== 'none' ? deps.host.rememberNames(false) : undefined))
      .catch((error: unknown) => {
        // The next refresh writes again.
        lastShown = null;
        deps.onError(`widgets: ${error instanceof Error ? error.message : String(error)}`);
      });
    return queue;
  };

  const remove = (): Promise<void> =>
    lastShown === REMOVED ? queue : run(REMOVED, false, () => deps.host.remove());

  const write = (inputs: WidgetInputs): Promise<void> => {
    if (!inputs.computersSaved) return remove();
    if (inputs.sources.length === 0) {
      // No summary to build rows without names from: with names switched off, a file that may carry them goes,
      // also one whose record is unknown.
      return !inputs.showSessionNames && (namesQueued || deps.host.namesRecord() !== 'none') ? remove() : queue;
    }
    const now = deps.now();
    const reading = inputs.selectedMachineId === null ? undefined : usage.get(inputs.selectedMachineId);
    const fresh = reading !== undefined && now - reading.readAt <= USAGE_MAX_AGE_MS;
    const snapshot = buildSnapshot(inputs.sources, now, fresh ? reading.bars : [], inputs.showSessionNames);
    const shown = JSON.stringify({ ...snapshot, writtenAt: snapshot.writtenAt.slice(0, 16) });
    if (shown === lastShown) return queue;
    const json = JSON.stringify(snapshot);
    return run(shown, inputs.showSessionNames, () => deps.host.write(json));
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
