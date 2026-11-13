/**
 * The Beads view's Tree and a bead's page model, from the desktop's own rules
 * (`packages/gx-core/src/beads_view`, `json_api::tree` and `json_api::bead`) run in the phone's
 * WebAssembly core (`beadsTree`, `beadsBead`), so the phone and the desktop arrange beads the same
 * way and a rule change rides the over-the-air update that carries the core. The phone draws what
 * comes back. Rows carry no agents (the phone has no session store for the project).
 *
 * SEE-ALSO: packages/gx-core/src/beads_view/json_api.rs, packages/gx-chat-wasm/src/lib.rs
 */

import { wasmCoreBridge } from '../chat/rust/wasm-core/bridge';
import type { BeadsReadiness, BeadsRow } from './model';

export type BeadsFilter = 'all' | 'needsDecision' | 'ready' | 'inProgress' | 'blocked' | 'deferred';
export type BeadGlyph = 'open' | 'inProgress' | 'blocked' | 'snoozed' | 'onIce' | 'review' | 'decision' | 'closed' | 'epic';

export type BeadRowModel = {
  id: string;
  title: string;
  glyph: BeadGlyph;
  /** "Task", "In Epic one", "Waiting on …", "Until Fri", "On ice", "Due Mon, Nov 17", a custom status. */
  meta: string[];
  labels: string[];
  commentCount: number;
  priority: string | null;
  needsDecision: boolean;
  closed: boolean;
  claimable: boolean;
};

export type EpicSummary = { total: number; done: number; text: string };

export type BeadsSection = {
  key: string;
  kind: 'needsDecision' | 'epic' | 'notInEpic';
  title: string;
  epic: BeadRowModel | null;
  count: number;
  summary: EpicSummary | null;
  rows: BeadRowModel[];
  doneRows: BeadRowModel[];
  doneCount: number;
  doneOpen: boolean;
  collapsed: boolean;
};

export type BeadsTree = {
  sections: BeadsSection[];
  readinessOk: boolean;
  /** The filters to offer: Ready and Blocked only while bd's readiness can be trusted. */
  filters: { key: BeadsFilter; label: string; count: number }[];
  /** The filter the tree applied (All while a readiness filter is held back). */
  filter: BeadsFilter;
};

export type BeadsTreeOptions = {
  filter: BeadsFilter;
  showDone: boolean;
  query: string;
  openDone: readonly string[];
  collapsed: readonly string[];
};

export type BeadPage = {
  row: BeadRowModel;
  /** "Open", "In progress", "Done", a custom status. */
  status: string;
  /** The epic above the bead, with its progress. */
  epic: { id: string; title: string; summary: EpicSummary } | null;
  /** The bead's own progress, when it is an epic. */
  summary: EpicSummary | null;
};

type RawCall = (op: 'beadsTree' | 'beadsBead', argumentsJson: string) => Promise<unknown>;

let rawCall: RawCall = (op, argumentsJson) => wasmCoreBridge.call({ op, args: [argumentsJson] });

/** Runs the same calls on another copy of the core (a harness that loads the wasm under bun). */
export function setBeadsCoreCallForHarness(call: RawCall): void {
  rawCall = call;
}

function clock() {
  const now = Date.now();
  return { nowMs: now, offsetMs: -new Date(now).getTimezoneOffset() * 60_000 };
}

async function ask<T>(op: 'beadsTree' | 'beadsBead', args: Record<string, unknown>): Promise<T> {
  const answer = (await rawCall(op, JSON.stringify({ ...args, ...clock() }))) as { ok?: T; error?: { message?: string } };
  if (answer.ok === undefined) throw new Error(answer.error?.message ?? 'The Beads rules did not answer.');
  return answer.ok;
}

export function beadsTree(beads: BeadsRow[], readiness: BeadsReadiness, options: BeadsTreeOptions): Promise<BeadsTree> {
  return ask<BeadsTree>('beadsTree', { beads, readiness, options });
}

export async function beadPage(beads: BeadsRow[], readiness: BeadsReadiness, id: string): Promise<BeadPage | null> {
  const answer = await ask<{ row: BeadRowModel | null } & Omit<BeadPage, 'row'>>('beadsBead', { beads, readiness, id });
  return answer.row !== null ? (answer as BeadPage) : null;
}
