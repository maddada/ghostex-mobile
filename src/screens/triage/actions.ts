/**
 * A short reply from the folded triage: the text goes to the session the way the session is shown on the phone. In
 * Chat View it is a chat message (`ghostex send-session-chat-message`, the send the terminal screen's Prompt Editor
 * uses in Chat View); in Terminal View the computer types it into the session's terminal and presses Enter (`ghostex
 * send-message`), whether or not the phone has that terminal open. Sending to a session is interacting with it, so its
 * attention is then acknowledged, as the chat's send does. Free of React Native: the screen hands in the real runner
 * and acknowledge, a test its fakes.
 */

import { sendSessionChatMessageCommand, sendSessionMessageCommand } from '../../commands/ghostexCli';
import type { GhostexSession } from '../../contract/mobileSummary';
import type { MachineConnectionTarget } from '../../machines/credentials';

export type ShortReplyTarget = {
  machine: MachineConnectionTarget;
  session: GhostexSession;
  /** The session opens in Chat View on this phone (`sessionOpensInChatView`). */
  chatView: boolean;
};

export type ShortReplyDeps = {
  /** Runs one `ghostex` command on the computer; rejects when it fails (`runGhostexCli`). */
  run(machine: MachineConnectionTarget, command: string): Promise<unknown>;
  /**
   * Types the reply into the session's terminal and presses Enter over the phone's own link to
   * the computer (`/api/sendSessionMessage`), with this phone's own token, so a paired phone isn't
   * asked to approve it as the CLI on the computer (the token file) is (GitHub #495). Without it,
   * `run` sends `ghostex send-message`.
   */
  sendToTerminal?(machine: MachineConnectionTarget, session: GhostexSession, text: string): Promise<void>;
  acknowledge(machineId: string, sessionId: string): void;
};

export async function sendShortReply(target: ShortReplyTarget, text: string, deps: ShortReplyDeps): Promise<void> {
  const { machine, session, chatView } = target;
  if (!chatView && deps.sendToTerminal !== undefined) {
    await deps.sendToTerminal(machine, session, text);
  } else {
    await deps.run(
      machine,
      chatView
        ? sendSessionChatMessageCommand(session.sessionId, session.projectId, text)
        : sendSessionMessageCommand(session.sessionId, session.projectId, text),
    );
  }
  deps.acknowledge(machine.id, session.sessionId);
}
