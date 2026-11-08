/**
 * What the Sessions screen does for Main Hub's GBots (contract/gbots.ts): the bot's long-press menu (New Chat, GBot
 * Settings, Remove GBot), the heading's (New GBot), the remove confirm, GBot Settings and the New GBot form, each run
 * as a `ghostex gbots` command on the bot's computer. Kept out of SessionsScreen.tsx, which only wires it in.
 *
 * CDXC:GBots 2026-11-09 SEE-ALSO: the DECISION in contract/gbots.ts (the menus' rows); Pause Routines joins the bot's
 * menu with routines in a later milestone.
 */

import { useCallback, useState, type ReactElement } from 'react';

import ConfirmDialog from '../../components/common/ConfirmDialog';
import ContextMenu, { type ContextMenuItem, type MenuAnchor } from '../../components/sessions/ContextMenu';
import { runGhostexCli } from '../../components/sessions/cli';
import { PlusGlyph, SettingsGlyph, TrashGlyph } from '../../components/sessions/icons';
import {
  gbotsCreateCommand,
  gbotsNewChatCommand,
  gbotsRemoveCommand,
} from '../../commands/ghostexCli';
import {
  gbotsOnIn,
  parseGbotNewChat,
  type GbotRowModel,
} from '../../contract/gbots';
import type { GhostexMobileSummary } from '../../contract/mobileSummary';
import type { MachineRecord } from '../../machines/store';
import { useAppearance } from '../../theme/useAppearance';
import GbotSettingsHost from './GbotSettingsHost';
import NewGbotSheet from './NewGbotSheet';

/** A GBot's add waits for the user's approval on the computer or phone (the CLI waits for it). */
const CREATE_TIMEOUT_MS = 5 * 60 * 1000;

type GbotRef = { botId: string; name: string };

export type GbotsScreenDeps = {
  machineById: (machineId: string) => MachineRecord | null;
  /** Opens a session the computer just created, as Chief's New Chat does. */
  attachCreated: (target: MachineRecord, sessionId: string) => Promise<void>;
  refreshMachine: (target: MachineRecord) => Promise<void> | void;
  setProgress: (message: string | null) => void;
  setTransientStatus: (message: string | null, options?: { title?: string; error?: boolean }) => void;
};

export function useGbots(deps: GbotsScreenDeps) {
  const { machineById, attachCreated, refreshMachine, setProgress, setTransientStatus } = deps;
  const appearance = useAppearance();
  const [menu, setMenu] = useState<{ title: string; items: ContextMenuItem[]; anchor?: MenuAnchor } | null>(null);
  const [removing, setRemoving] = useState<{ target: MachineRecord; bot: GbotRef } | null>(null);
  const [settings, setSettings] = useState<{ target: MachineRecord; bot: GbotRef } | null>(null);
  const [adding, setAdding] = useState<MachineRecord | null>(null);

  const failed = useCallback(
    (title: string, error: unknown): void =>
      setTransientStatus(error instanceof Error ? error.message : String(error), { title, error: true }),
    [setTransientStatus],
  );

  const newChat = useCallback(
    async (target: MachineRecord, bot: GbotRef): Promise<void> => {
      setMenu(null);
      setProgress(`Opening a chat with ${bot.name}…`);
      try {
        const result = await runGhostexCli(target, gbotsNewChatCommand(bot.botId));
        setProgress(null);
        const chat = parseGbotNewChat(result.json);
        if (chat !== null) await attachCreated(target, chat.sessionId);
        void refreshMachine(target);
      } catch (error) {
        setProgress(null);
        failed('Chat not opened', error);
      }
    },
    [attachCreated, failed, refreshMachine, setProgress],
  );

  const remove = useCallback(
    async (target: MachineRecord, bot: GbotRef): Promise<void> => {
      setProgress(`Removing ${bot.name}…`);
      try {
        await runGhostexCli(target, gbotsRemoveCommand(bot.botId));
        setProgress(null);
        setTransientStatus(`Its chats are closed and its folder is in the Trash.`, { title: `${bot.name} removed` });
        void refreshMachine(target);
      } catch (error) {
        setProgress(null);
        failed('GBot not removed', error);
      }
    },
    [failed, refreshMachine, setProgress, setTransientStatus],
  );

  const refOf = (row: GbotRowModel): GbotRef => ({ botId: row.bot.id, name: row.bot.name });
  const iconColor = appearance.foreground;

  /** Long press on a bot. */
  const openBotMenu = useCallback(
    (machineId: string, row: GbotRowModel, anchor?: MenuAnchor): void => {
      const target = machineById(machineId);
      if (target === null) return;
      const bot = refOf(row);
      setMenu({
        title: row.bot.title.length > 0 ? `${row.bot.name} · ${row.bot.title}` : row.bot.name,
        anchor,
        items: [
          {
            kind: 'item',
            key: 'gbot-new-chat',
            label: 'New Chat',
            icon: <PlusGlyph size={14} color={iconColor} />,
            onPress: () => void newChat(target, bot),
          },
          {
            kind: 'item',
            key: 'gbot-settings',
            label: 'GBot Settings',
            icon: <SettingsGlyph size={14} color={iconColor} />,
            onPress: () => {
              setMenu(null);
              setSettings({ target, bot });
            },
          },
          { kind: 'separator', key: 'gbot-remove-separator' },
          {
            kind: 'item',
            key: 'gbot-remove',
            label: 'Remove GBot',
            destructive: true,
            icon: <TrashGlyph size={14} color={appearance.danger} />,
            onPress: () => {
              setMenu(null);
              setRemoving({ target, bot });
            },
          },
        ],
      });
    },
    [appearance.danger, iconColor, machineById, newChat],
  );

  /** The New GBot row, for the GBots heading's menu and Main Hub's while GBots are on. */
  const newGbotItem = useCallback(
    (target: MachineRecord, close: () => void): ContextMenuItem => ({
      kind: 'item',
      key: 'gbots-new',
      label: 'New GBot',
      icon: <PlusGlyph size={14} color={iconColor} />,
      onPress: () => {
        close();
        setAdding(target);
      },
    }),
    [iconColor],
  );

  /** Long press on the GBots heading. */
  const openHeadingMenu = useCallback(
    (machineId: string): void => {
      const target = machineById(machineId);
      if (target === null) return;
      setMenu({ title: 'GBots', items: [newGbotItem(target, () => setMenu(null))] });
    },
    [machineById, newGbotItem],
  );

  /** Main Hub's menu offers New GBot while GBots are on, so the first GBot can be added before the heading exists. */
  const homeMenuItems = useCallback(
    (target: MachineRecord, summary: GhostexMobileSummary | null | undefined, close: () => void): ContextMenuItem[] =>
      gbotsOnIn(summary) ? [newGbotItem(target, close)] : [],
    [newGbotItem],
  );

  const toggleBotChatOnEmpty = useCallback(
    (machineId: string, row: GbotRowModel): void => {
      const target = machineById(machineId);
      if (target !== null) void newChat(target, refOf(row));
    },
    [machineById, newChat],
  );

  const overlays: ReactElement = (
    <>
      {menu !== null ? (
        <ContextMenu
          visible
          title={menu.title}
          items={menu.items}
          rowAnchor={menu.anchor}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {removing !== null ? (
        <ConfirmDialog
          visible
          title={`Remove ${removing.bot.name}?`}
          body="Its chats close and its folder goes to the Trash."
          confirmLabel="Remove GBot"
          destructive
          onConfirm={() => {
            const pending = removing;
            setRemoving(null);
            void remove(pending.target, pending.bot);
          }}
          onCancel={() => setRemoving(null)}
        />
      ) : null}
      {settings !== null ? (
        <GbotSettingsHost
          target={settings.target}
          botId={settings.bot.botId}
          name={settings.bot.name}
          onClose={() => setSettings(null)}
          onSaved={(name) => {
            setTransientStatus('Chats opened from now on start with the changes.', { title: `${name} saved` });
            void refreshMachine(settings.target);
          }}
        />
      ) : null}
      {adding !== null ? (
        <NewGbotSheet
          onCreate={async (fields) => {
            const target = adding;
            await runGhostexCli(target, gbotsCreateCommand(fields), { timeoutMs: CREATE_TIMEOUT_MS });
            setAdding(null);
            setTransientStatus('Long-press it under GBots to open a chat or change its settings.', {
              title: `${fields.name} added`,
            });
            void refreshMachine(target);
          }}
          onCancel={() => setAdding(null)}
        />
      ) : null}
    </>
  );

  return { openBotMenu, openHeadingMenu, homeMenuItems, newChatFor: toggleBotChatOnEmpty, overlays };
}
