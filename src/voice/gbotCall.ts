/**
 * Calls with a GBot on the phone: the Voice agent call opened with `focus=gbot:<botId>[:<projectId>:<sessionId>]`,
 * which gxserver turns into a call spoken as that GBot about your standing chat with it or one of its chats
 * (server/src/voice_agent/gbot_call/). It starts from a GBot's long press ("Call", beside New Chat) and from a GBot's
 * chat (its ⋯ menu's "Call <GBot>", in place of "Voice call about this chat"), through `callVoiceAbout`
 * (callAbout.ts), which asks before hanging up a call that is open.
 *
 * CDXC:GBots 2026-11-09 DECISION: User: "start a call with a GBot (from its row's menu, its chat, and the phone)", and "GBots off means no call buttons anywhere". Call shows on a GBot's long press and "Call <GBot>" in a GBot's chat only while GBots and the Voice agent are both on; a GBot whose chats run on another computer gets a greyed Call. A call with a GBot stays with it (no All sessions; another call about something else is hang up and call), and the voice picker during it sets that GBot's voice instead of the Voice agent's.
 * SEE-ALSO: apps/desktop/src/app/voice_agent/gbot_call.rs (the desktop's same rules), voice/focus.ts (`gbotFocusRef`, `voiceCallAboutAction`'s `replace`), voice/GbotCallBanner.tsx (the voice screen's banner), voice/gbotVoice.ts.
 */

import { useMemo } from 'react';

import { chatMachineLink } from '../chat/rust/machine-link';
import { gbotsOnIn } from '../contract/gbots';
import type { GhostexGbotsBot, GhostexMobileSummary } from '../contract/mobileSummary';
import { useInventoryStore } from '../inventory/store';
import type { MachineConnectionTarget } from '../machines/credentials';
import { callVoiceAbout } from './callAbout';
import { VOICE_SUPPORTED } from './conversation';
import { voiceAgentOnIn } from './featureSwitch';

/** The GBot a call is with, as the menus know it. */
export type GbotCallee = { botId: string; name: string };

type SummaryFeatures = Pick<GhostexMobileSummary, 'builtInFeatures' | 'builtInFeaturesOff'>;

/** Whether a computer offers calls with its GBots: the phone can call, and GBots and the Voice agent are both on. */
export function gbotCallsOnIn(summary: SummaryFeatures | null | undefined): boolean {
  return VOICE_SUPPORTED && gbotsOnIn(summary) && voiceAgentOnIn(summary);
}

/** Whether the GBot's chats run on its own computer (a call reaches only those). */
export function gbotChatsHere(bot: Pick<GhostexGbotsBot, 'computer'>): boolean {
  return bot.computer === undefined || bot.computer.kind === 'this';
}

/**
 * What a GBot's long press offers: no Call (calls off, or no voice agent on that computer's gxserver), a greyed one
 * with why (its chats run elsewhere), or Call.
 */
export function gbotRowCall(
  machine: MachineConnectionTarget,
  summary: SummaryFeatures | null | undefined,
  bot: GhostexGbotsBot,
): { kind: 'hidden' } | { kind: 'elsewhere'; why: string } | { kind: 'ready' } {
  if (!gbotCallsOnIn(summary)) return { kind: 'hidden' };
  if (chatMachineLink(machine).capabilities()?.includes('voiceAgent') !== true) return { kind: 'hidden' };
  if (!gbotChatsHere(bot)) {
    const where = bot.computer?.name ?? '';
    return {
      kind: 'elsewhere',
      why: `${bot.name}'s chats run on ${where.length > 0 ? where : 'another computer'}, so a call can't reach it from here.`,
    };
  }
  return { kind: 'ready' };
}

/**
 * Calls `bot` on `machine`: about `chat` (one of its chats), or with null your standing chat with it, which gxserver
 * opens if needed. `show` opens the voice screen.
 */
export function callGbot(
  machine: MachineConnectionTarget,
  bot: GbotCallee,
  chat: { projectId: string; sessionId: string; title: string } | null,
  show: () => void,
): void {
  callVoiceAbout(
    machine,
    {
      projectId: chat?.projectId ?? '',
      sessionId: chat?.sessionId ?? '',
      title: chat?.title ?? bot.name,
      gbot: bot,
    },
    show,
  );
}

/**
 * The GBot whose chat `sessionId` is, while it can be called from that chat (calls on, its chats on this computer),
 * else null. The caller still checks that the computer's gxserver has the voice agent (`useVoiceCapability`).
 */
export function useGbotOfChat(machineId: string, projectId: string, sessionId: string): GbotCallee | null {
  const bot = useInventoryStore((store) => {
    const summary = store.inventoriesByMachineId[machineId]?.summary;
    if (summary === null || summary === undefined || !gbotCallsOnIn(summary)) return null;
    const session = summary.sessions.find((entry) => entry.sessionId === sessionId);
    const botId =
      session?.gbotsChat?.botId ?? summary.projects.find((project) => project.projectId === projectId)?.gbotsBot?.id;
    if (botId === undefined) return null;
    const found = summary.projects.find((project) => project.gbotsBot?.id === botId)?.gbotsBot;
    return found !== undefined && gbotChatsHere(found) ? found : null;
  });
  const botId = bot?.id ?? null;
  const name = bot?.name ?? '';
  return useMemo(() => (botId === null ? null : { botId, name }), [botId, name]);
}
