/**
 * Which one computer pushes the Live Activity while the phone is locked (its "banner computer"). That computer
 * covers itself and every computer connected to it (Settings › Remote on the computer), so the phone hands its
 * Live Activity tokens to one computer only and never to two (`liveActivityPush.ts`).
 *
 * Among the computers that answered and can push the banner (their `ghostex server endpoint` lists
 * `liveActivityPush`), the pick is the first by:
 * 1. how many of the phone's computers with a working or waiting agent it covers;
 * 2. how many of the phone's computers it covers;
 * 3. whether it has a working or waiting agent itself;
 * 4. whether it holds the tokens now (no change without a reason);
 * 5. the lowest server id (stable).
 * None qualifies: null, and the tokens stay where they are.
 *
 * CDXC:Notifications 2026-11-11 DECISION: User, on which computer pushes the banner: "u should push from 1
 * machine. since usually ppl connect their machines together like their 2 pcs for ex. so u can actually push
 * status of both machines from 1 main machine."
 *
 * Kept free of React Native so it is testable under `bun test`.
 */

export type PickComputer = {
  /** The phone's id for the computer (`MachineRecord.id`). */
  machineId: string;
  /** The computer's server id, from its `registerLiveActivity` status. */
  serverId: string;
  /** It answered its last session list read and its last status. */
  answered: boolean;
  /** Its endpoint lists `liveActivityPush`. */
  capable: boolean;
  /** It has a working or waiting agent. */
  active: boolean;
  /** The server ids of the computers it can read for the banner. */
  speaksFor: readonly string[];
};

function covered(computer: PickComputer): Set<string> {
  return new Set([computer.serverId, ...computer.speaksFor]);
}

/** The phone's banner computer (its `machineId`), or null when none qualifies. */
export function pickBannerComputer(computers: readonly PickComputer[], holder: string | null): string | null {
  const everyServer = new Set(computers.map((computer) => computer.serverId));
  const activeServers = new Set(computers.filter((computer) => computer.active).map((computer) => computer.serverId));
  const count = (cover: Set<string>, among: Set<string>): number => [...cover].filter((id) => among.has(id)).length;
  const candidates = computers
    .filter((computer) => computer.answered && computer.capable && computer.serverId.length > 0)
    .map((computer) => {
      const cover = covered(computer);
      return {
        computer,
        keys: [
          count(cover, activeServers),
          count(cover, everyServer),
          computer.active ? 1 : 0,
          computer.machineId === holder ? 1 : 0,
        ],
      };
    });
  candidates.sort((a, b) => {
    for (let index = 0; index < a.keys.length; index += 1) {
      const difference = (b.keys[index] ?? 0) - (a.keys[index] ?? 0);
      if (difference !== 0) return difference;
    }
    return a.computer.serverId < b.computer.serverId ? -1 : a.computer.serverId > b.computer.serverId ? 1 : 0;
  });
  return candidates[0]?.computer.machineId ?? null;
}
