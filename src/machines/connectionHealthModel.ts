/**
 * When a connected computer's link counts as slow (`connectionHealth.ts` measures it). No React Native imports:
 * `bun test` runs this file directly.
 *
 * CDXC:RemoteMachines 2026-11-12 DECISION:
 * User (Q2744): a computer is slow when its round trip stays over 400 ms for 30 s, or its link dropped twice in 5
 * minutes, and it is green again after a minute under the limit. Its icon on the Sessions screen turns yellow while it
 * is slow, so the user can open the Connections sheet and send the logs.
 */

export const SLOW_ROUND_TRIP_MS = 400;
/** How long the round trip must stay over the limit. */
export const SLOW_FOR_MS = 30_000;
export const DROPS_WINDOW_MS = 5 * 60_000;
export const SLOW_DROPS = 2;
/** How long a slow link must stay under the limit, with no drop, before it is fine again. */
export const CALM_FOR_MS = 60_000;
/** Two drops closer than this are one (the chat's cut-off and the list's failure report the same drop). */
const SAME_DROP_MS = 10_000;
const KEEP_SAMPLES_MS = 2 * 60_000;

export type HealthSample = { at: number; ms: number };

export type MachineHealth = {
  samples: HealthSample[];
  drops: number[];
  /** When it last turned slow; null while it is fine. */
  slowSince: number | null;
  slowReason: 'roundTrip' | 'drops' | null;
  /** When it was last fine again: drops before this no longer count. */
  calmSince: number;
};

export function emptyHealth(): MachineHealth {
  return { samples: [], drops: [], slowSince: null, slowReason: null, calmSince: 0 };
}

export function withSample(health: MachineHealth, sample: HealthSample): MachineHealth {
  const samples = [...health.samples.filter((entry) => entry.at > sample.at - KEEP_SAMPLES_MS), sample];
  return { ...health, samples };
}

export function withDrop(health: MachineHealth, at: number): MachineHealth {
  const last = health.drops[health.drops.length - 1];
  if (last !== undefined && at - last < SAME_DROP_MS) return health;
  return { ...health, drops: [...health.drops.filter((drop) => drop > at - DROPS_WINDOW_MS), at] };
}

/** The trailing run of samples on one side of the limit: how long it has lasted, or 0 when there is none. */
function runSpan(samples: readonly HealthSample[], over: boolean, now: number): number {
  let first: number | null = null;
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const sample = samples[index];
    if (sample === undefined || sample.ms > SLOW_ROUND_TRIP_MS !== over) break;
    first = sample.at;
  }
  return first === null ? 0 : now - first;
}

/** `health` with its slow state brought up to `now`. */
export function evaluateHealth(health: MachineHealth, now: number): MachineHealth {
  const recentDrops = health.drops.filter((drop) => drop > now - DROPS_WINDOW_MS && drop > health.calmSince);
  if (health.slowSince === null) {
    if (runSpan(health.samples, true, now) >= SLOW_FOR_MS) {
      return { ...health, slowSince: now, slowReason: 'roundTrip' };
    }
    if (recentDrops.length >= SLOW_DROPS) return { ...health, slowSince: now, slowReason: 'drops' };
    return health;
  }
  const lastDrop = health.drops[health.drops.length - 1] ?? 0;
  const calm = now - lastDrop >= CALM_FOR_MS && runSpan(health.samples, false, now) >= CALM_FOR_MS;
  return calm ? { ...health, slowSince: null, slowReason: null, calmSince: now } : health;
}

/** The newest round trip measured, or null. */
export function latestRoundTrip(health: MachineHealth | undefined): number | null {
  return health?.samples[health.samples.length - 1]?.ms ?? null;
}

/** Drops in the last 5 minutes. */
export function recentDropCount(health: MachineHealth | undefined, now: number): number {
  return health?.drops.filter((drop) => drop > now - DROPS_WINDOW_MS).length ?? 0;
}
