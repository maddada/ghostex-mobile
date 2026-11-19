/**
 * The commands a reply offers to run in a terminal, read out of the core's marked Markdown: a fence
 * whose header carries `run`, and an inline span the core wrapped in a `ghostex-run:` link.
 *
 * CDXC:SessionChat 2026-10-24 SEE-ALSO: which commands qualify and the text each runs is decided in
 * packages/gx-chat-core/src/transcript/run_command.rs; the desktop draws its buttons in
 * apps/desktop/src/app/native_chat/run_command.rs. Per the phone's long-press rule, a code block's Run
 * sits beside its copy button (`Markdown.tsx`), and the message's menu offers Copy command and Paste
 * in terminal for a message with one inline command, or Run in terminal for one with one command
 * block (`MessageActions.tsx`).
 */

import { parseMarkdown, type Block, type Inline } from './parse';

const RUN_COMMAND_HREF_PREFIX = 'ghostex-run:';
/**
 * A span that is a command only by its shape (an unknown program with a flag or a path, gx-chat-core
 * `SHAPE_COMMAND_HREF_PREFIX`): drawn as a command chip like the others, but never the reply's one
 * command in its long-press menu, so a looser span does not take a real command's rows away.
 */
const SHAPE_COMMAND_HREF_PREFIX = 'ghostex-run-shape:';

function encodedCommand(href: string): string | null {
  if (href.startsWith(RUN_COMMAND_HREF_PREFIX)) return href.slice(RUN_COMMAND_HREF_PREFIX.length);
  if (href.startsWith(SHAPE_COMMAND_HREF_PREFIX)) return href.slice(SHAPE_COMMAND_HREF_PREFIX.length);
  return null;
}

export function isRunCommandHref(href: string): boolean {
  return encodedCommand(href) !== null;
}

/** Whether a run link is a command only by its shape (`SHAPE_COMMAND_HREF_PREFIX`). */
export function isShapeCommandHref(href: string): boolean {
  return href.startsWith(SHAPE_COMMAND_HREF_PREFIX);
}

/**
 * The command a `ghostex-run:` href carries, or null. The core writes only one-line commands there,
 * so one holding a line break or other control character is not the core's and is refused, as
 * `command_from_href` in packages/gx-chat-core/src/transcript/run_command.rs does.
 */
export function commandFromHref(href: string): string | null {
  const encoded = encodedCommand(href);
  if (encoded === null) return null;
  try {
    const command = decodeURIComponent(encoded);
    if (command.trim().length === 0) return null;
    // eslint-disable-next-line no-control-regex
    return /[\u0000-\u001f\u007f-\u009f]/.test(command) ? null : command;
  } catch {
    return null;
  }
}

/**
 * A command a message holds: an inline span's (`inline`) or a code block's; `shape` when the span is
 * a command only by its shape (`isShapeCommandHref`).
 */
export type MessageCommand = { command: string; inline: boolean; shape: boolean };

function inlineCommands(inlines: readonly Inline[], out: MessageCommand[]): void {
  for (const inline of inlines) {
    if (inline.t === 'link') {
      const command = commandFromHref(inline.href);
      if (command !== null) out.push({ command, inline: true, shape: isShapeCommandHref(inline.href) });
      else inlineCommands(inline.c, out);
    } else if (inline.t === 'strong' || inline.t === 'em' || inline.t === 'del') {
      inlineCommands(inline.c, out);
    }
  }
}

function blockCommands(blocks: readonly Block[], out: MessageCommand[]): void {
  for (const block of blocks) {
    switch (block.t) {
      case 'code':
        if (block.run !== null) out.push({ command: block.run, inline: false, shape: false });
        break;
      case 'p':
      case 'h':
        inlineCommands(block.c, out);
        break;
      case 'list':
        for (const item of block.items) blockCommands(item.c, out);
        break;
      case 'quote':
      case 'alert':
        blockCommands(block.c, out);
        break;
      case 'section':
        blockCommands(block.all, out);
        break;
      case 'table':
        for (const cell of block.head) inlineCommands(cell, out);
        for (const row of block.rows) for (const cell of row) inlineCommands(cell, out);
        break;
      default:
        break;
    }
  }
}

/** Every distinct command in a message's marked Markdown, in the order they appear. */
export function messageCommands(markdown: string): MessageCommand[] {
  if (!markdown.includes('"run"') && !markdown.includes('ghostex-run')) return [];
  const out: MessageCommand[] = [];
  blockCommands(parseMarkdown(markdown), out);
  const seen = new Set<string>();
  return out.filter((entry) => !seen.has(entry.command) && seen.add(entry.command) !== undefined);
}
