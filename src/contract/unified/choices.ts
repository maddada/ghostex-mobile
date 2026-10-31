/**
 * Where a new session starts: the project and machine choices of the new chat's tray, and the
 * project the header's New session aims at.
 *
 * A port of packages/gx-core/src/unified_sidebar/choices.rs, held to it by `unifiedFixture.json`.
 */

import type { UnifiedFilter, UnifiedProjectInput } from './build';
import { repoIdentity } from './repo';

export type UnifiedChoiceMachineInput = {
  machine: string;
  label: string;
  /** A session can start there now; one that isn't keeps its chip, dimmed. */
  connected: boolean;
  projects: Pick<UnifiedProjectInput, 'projectId' | 'title' | 'path' | 'gitRemoteOriginUrl' | 'worktreeParentPath'>[];
};

export type UnifiedChoiceMachine = {
  machineId: string;
  label: string;
  connected: boolean;
  projectId: string;
};

export type UnifiedProjectChoice = {
  repoKey: string;
  label: string;
  machines: UnifiedChoiceMachine[];
  /** Which chip the row starts on. */
  selected: number;
};

function byCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * One row per repository with a chip per machine. A row starts on the machine last used for it,
 * else the current one, else `localMachine`, else the first. Each chip points at that machine's
 * main checkout; a worktree stands in only when the machine has nothing else of the repository.
 */
export function unifiedProjectChoices(
  machines: readonly UnifiedChoiceMachineInput[],
  lastMachines: Readonly<Record<string, string>>,
  currentMachine: string,
  localMachine = 'local',
): UnifiedProjectChoice[] {
  const byRepo = new Map<string, UnifiedProjectChoice>();
  for (const machine of machines) {
    const picks = new Map<string, { project: UnifiedChoiceMachineInput['projects'][number]; label: string }>();
    for (const project of machine.projects) {
      const repo = repoIdentity(project.gitRemoteOriginUrl, project.path, project.worktreeParentPath, project.title);
      const pick = picks.get(repo.key);
      if (pick === undefined || (pick.project.worktreeParentPath !== null && project.worktreeParentPath === null)) {
        picks.set(repo.key, { project, label: pick?.label ?? repo.label });
      }
    }
    for (const repoKey of [...picks.keys()].sort(byCodePoint)) {
      const { project, label } = picks.get(repoKey)!;
      let choice = byRepo.get(repoKey);
      if (choice === undefined) {
        choice = { repoKey, label, machines: [], selected: 0 };
        byRepo.set(repoKey, choice);
      }
      choice.machines.push({
        machineId: machine.machine,
        label: machine.label,
        connected: machine.connected,
        projectId: project.projectId,
      });
    }
  }
  const choices = [...byRepo.values()];
  for (const choice of choices) {
    const chipOf = (machineId: string | undefined) => choice.machines.findIndex((chip) => chip.machineId === machineId);
    const candidates = [chipOf(lastMachines[choice.repoKey]), chipOf(currentMachine), chipOf(localMachine)];
    choice.selected = candidates.find((chip) => chip >= 0) ?? 0;
  }
  return choices.sort(
    (left, right) =>
      byCodePoint(left.label.toLowerCase(), right.label.toLowerCase()) || byCodePoint(left.repoKey, right.repoKey),
  );
}

/** The rows whose name, or a machine's name, holds every typed word. */
export function filterProjectChoices(choices: readonly UnifiedProjectChoice[], query: string): UnifiedProjectChoice[] {
  const words = query.toLowerCase().split(/\s+/u).filter((word) => word.length > 0);
  return choices.filter((choice) => {
    const haystack = [choice.label, ...choice.machines.map((machine) => machine.label)].join('\n').toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** The project the header's New session aims at: null starts where the session is open. */
export function unifiedNewSessionTarget(
  filter: UnifiedFilter,
  choices: readonly UnifiedProjectChoice[],
  activeProjectId: string | null,
): { machineId: string; projectId: string } | null {
  if (filter.repos.length !== 1) return null;
  const choice = choices.find((entry) => entry.repoKey === filter.repos[0]);
  if (choice === undefined) return null;
  if (activeProjectId !== null && choice.machines.some((machine) => machine.projectId === activeProjectId)) return null;
  const machine = choice.machines[choice.selected];
  return machine === undefined ? null : { machineId: machine.machineId, projectId: machine.projectId };
}
