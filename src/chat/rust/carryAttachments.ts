/**
 * A send's picture references (`[Image #1](path)`) whose file is on another computer than the
 * session's: the picture is read from the computer that has it and saved on the session's, and the
 * reference points at the copy before the message leaves. The phone has no files of its own and no
 * hook for pasted text, so this runs at send only; other files have no read call on a computer and
 * stay as they are.
 *
 * The rule (which references, how they are rewritten) is the chat core's
 * (`composer/attachment_moves.rs`, where the user's words are); a core too old to answer the two
 * queries leaves the text as it is.
 * SEE-ALSO: apps/desktop/src/app/native_chat/carry_attachments.rs (the desktop's copy, which also runs on paste)
 */

import { isCloudBoxMachineId } from '../../cloudBoxes/types';
import { isDemoMachine } from '../../demo/identity';
import type { MachineConnectionTarget } from '../../machines/credentials';
import { enabledMachines, useMachinesStore } from '../../machines/store';
import type { ChatCoreQuery } from './core-types';
import { sessionChatRpc } from './transport';

/** How long a computer that may hold the picture gets to answer. */
const READ_ELSEWHERE_TIMEOUT_MS = 15_000;

const PICTURE_PATH = /\.(avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/iu;

/** A cheap look for a numbered attachment label, so a send with none never waits on the core. */
const ATTACHMENT_LABEL = /\[(?:Image|File|PDF|Audio|Video|Folder) #\d+\]\(/u;

export type CarryOutcome = { text: string; error: string | null };

export class AttachmentCarrier {
  /** Paths on the session's computer, or that no copy can be made of (looked at once). */
  private readonly checked = new Set<string>();
  /** Paths copied to the session's computer, and where the copy is. */
  private readonly moved = new Map<string, string>();

  constructor(
    private readonly session: { machine: MachineConnectionTarget; projectId: string; sessionId: string },
    private readonly query: (name: ChatCoreQuery, args: readonly unknown[]) => Promise<unknown>,
  ) {}

  /** Paths an upload from this phone just saved on the session's computer. */
  noteOnSessionComputer(paths: readonly string[]): void {
    for (const path of paths) this.checked.add(path);
  }

  /** Whether `text` may hold an attachment reference at all. */
  mayCarry(text: string): boolean {
    return ATTACHMENT_LABEL.test(text);
  }

  /** `text` with its references to pictures elsewhere pointing at copies on the session's computer. */
  async carry(text: string): Promise<CarryOutcome> {
    const paths = await this.query('attachmentReferencePaths', [text]);
    if (!Array.isArray(paths)) return { text, error: null };
    let error: string | null = null;
    for (const path of paths) {
      if (typeof path !== 'string' || this.checked.has(path) || this.moved.has(path)) continue;
      this.checked.add(path);
      if (!PICTURE_PATH.test(path) || /^https?:\/\//iu.test(path)) continue;
      error = (await this.carryOne(path)) ?? error;
    }
    return { text: await this.retarget(text), error };
  }

  /** `text` with the references already copied pointing at their copies. */
  async retarget(text: string): Promise<string> {
    if (this.moved.size === 0) return text;
    const next = await this.query('retargetAttachmentReferences', [text, [...this.moved.entries()]]);
    return typeof next === 'string' ? next : text;
  }

  /** Copies one picture the session's computer lacks; answers why it failed, or null. */
  private async carryOne(path: string): Promise<string | null> {
    const { machine, projectId, sessionId } = this.session;
    const there = await sessionChatRpc(machine, 'readSessionChatImage', { path });
    if (there.error === null) return null;
    const others = enabledMachines(useMachinesStore.getState()).filter(
      (other) => other.id !== machine.id && !isDemoMachine(other) && !isCloudBoxMachineId(other.id),
    );
    const name = path.split(/[\\/]/u).pop() || 'image.png';
    for (const other of others) {
      const read = await sessionChatRpc(other, 'readSessionChatImage', { path }, READ_ELSEWHERE_TIMEOUT_MS);
      const base64Data = (read.result as { base64Data?: unknown } | undefined)?.base64Data;
      if (read.error !== null || typeof base64Data !== 'string') continue;
      const saved = await sessionChatRpc(machine, 'saveSessionChatImage', {
        projectId,
        sessionId,
        base64Data,
        suggestedName: name,
      });
      const to = (saved.result as { path?: unknown } | undefined)?.path;
      if (saved.error !== null || typeof to !== 'string') {
        return `${name} couldn't be copied to this chat's computer: ${saved.error?.message ?? 'the save failed'}`;
      }
      this.checked.add(to);
      this.moved.set(path, to);
      return null;
    }
    return null;
  }
}
