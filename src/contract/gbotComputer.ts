/**
 * Where a GBot's chats run, as `ghostex gbots computer --json` answers it (server/src/gbots/computer/ops.rs): this
 * computer, a connected computer (with the folder its chats work in there) or a Cloud Box, whether it may use that
 * computer's screen, and how many of its chats run elsewhere.
 */

export type GbotComputer = {
  kind: 'this' | 'computer' | 'cloudBox';
  /** The computer's or box's name ("This computer" for `this`). */
  name: string;
  /** The folder its chats work in on that computer; empty for this computer and a Cloud Box. */
  folder: string;
  computerUse: boolean;
  /** That computer is connected (or the box exists) now. */
  available: boolean;
  /** This computer's own name. */
  thisComputer: string;
  chatsElsewhere: number;
};

type Json = Record<string, unknown>;

function record(value: unknown): Json | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function parseGbotComputer(answer: unknown): GbotComputer | null {
  const root = record(answer);
  const computer = record(root?.computer);
  if (root === null || computer === null) return null;
  const kind = text(computer.kind);
  return {
    kind: kind === 'computer' || kind === 'cloudBox' ? kind : 'this',
    name: text(computer.name),
    folder: text(computer.folder),
    computerUse: computer.computerUse === true,
    available: computer.available !== false,
    thisComputer: text(root.thisComputer),
    chatsElsewhere: Array.isArray(root.remoteChats) ? root.remoteChats.length : 0,
  };
}
