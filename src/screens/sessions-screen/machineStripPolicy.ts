/**
 * CDXC:Sidebar 2026-11-02 DECISION:
 * User: "We shouldn't keep the machines list, since we are already showing all of the projects from all of the machines." Unified hides the computer tabs; Project keeps them. This supersedes the 2026-11-01 choice to keep tabs in Unified for their connect controls, now reached through the Computers menu and the machine notice line above the search row.
 */
export function machineTabsVisible(unified: boolean, machineCount: number): boolean {
  return !unified && machineCount > 0;
}

/**
 * Whether the header's New session, with the filter narrowed to one project, starts where the open
 * session is: only when that session belongs to the project on that computer. Otherwise it asks for
 * one of the project's reachable computers, since Unified has no computer tab to imply one.
 */
export function newSessionStartsInOpen(
  projectMachines: readonly { machineId: string; projectId: string }[],
  open: { machineId: string; projectId: string } | null,
): boolean {
  return (
    open !== null &&
    projectMachines.some((machine) => machine.machineId === open.machineId && machine.projectId === open.projectId)
  );
}
