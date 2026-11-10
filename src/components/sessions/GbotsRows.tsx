/**
 * Main Hub's GBots section (contract/gbots.ts): the GBots heading, drawn like the in-project Pinned and Sessions
 * headings (a tap folds it, a long press offers New GBot), then one row per GBot: its chevron, its icon in its colour,
 * its name and one status dot while any of its chats works or waits. A tap folds the bot's chats under it (newest
 * first, each the ordinary session row, so a tap opens the chat and a long press gives its usual menu); a long press
 * opens the bot's menu. The GBots of a department sit under its sub-heading (a tap folds them, a long press opens the
 * department's menu), its lead first with a small crown. Drawn in Main Hub's card right after Chief of Staff's row
 * (DrawerBlockView.tsx).
 *
 * CDXC:GBots 2026-11-09 SEE-ALSO: the DECISION in contract/gbots.ts; the desktop draws the same rows
 * (apps/desktop/src/app/native_sidebar/gbots_rows.rs).
 */

import { useRef, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewInstance } from 'react-native';

import {
  GBOTS_LABEL,
  gbotColorHex,
  type GbotChatItem,
  type GbotRowModel,
  type GbotsDepartmentModel,
  type GbotsSectionModel,
} from '../../contract/gbots';
import { measureInWindow } from '../common/measureInWindow';
import type { MenuAnchor } from './ContextMenu';
import { GbotIcon } from './gbotIcons';
import { ChevronRightGlyph, CloudGlyph, CrownGlyph, MachinesGlyph } from './icons';
import {
  ProjectEmptyRow,
  SectionStatusDots,
  SessionKindLabelRow,
  TOUCH_ROW_HEIGHT,
  ds,
  inkStyleSheets,
  inkWash,
  useSidebarInk,
} from './rows';
import StatusDotStack from './StatusDotStack';

export type GbotsRowsProps = {
  section: GbotsSectionModel;
  /** The open chat is one of these bots' (rings the folded heading). */
  containsActive: boolean;
  /** The surface the rows sit on, which a status dot's ring is drawn in. */
  ringColor: string;
  /** A chat's row: DrawerBlockView's session row, with the "Chief" tag on chats Chief of Staff opened. */
  renderChat: (chat: GbotChatItem) => ReactElement;
  onToggleHeading: () => void;
  /** Long press on the heading: New GBot. */
  onHeadingMenu: () => void;
  onToggleBot: (bot: GbotRowModel) => void;
  /** Long press on a bot: New Chat, GBot Settings, Remove GBot. */
  onBotMenu: (bot: GbotRowModel, anchor: MenuAnchor) => void;
  /** The empty row of a bot with no open chat. */
  onNewChat: (bot: GbotRowModel) => void;
  onToggleDepartment: (department: GbotsDepartmentModel) => void;
  /** The open chat is one of this department's bots' (rings the folded sub-heading). */
  departmentActive: (department: GbotsDepartmentModel) => boolean;
  /** Long press on a department: Department Settings, Remove Department. */
  onDepartmentMenu: (department: GbotsDepartmentModel) => void;
};

export default function GbotsRows(props: GbotsRowsProps): ReactElement {
  const { section } = props;
  const botBlock = (bot: GbotRowModel): ReactElement => (
    <View key={bot.projectKey}>
      <GbotRow
        bot={bot}
        ringColor={props.ringColor}
        onToggle={() => props.onToggleBot(bot)}
        onMenu={(anchor) => props.onBotMenu(bot, anchor)}
      />
      {bot.collapsed ? null : (
        <View style={styles.chats}>
          {bot.chats.length === 0 ? (
            <ProjectEmptyRow text="New Chat" onPress={() => props.onNewChat(bot)} />
          ) : (
            bot.chats.map((chat) => props.renderChat(chat))
          )}
        </View>
      )}
    </View>
  );
  return (
    <View style={styles.section}>
      <SessionKindLabelRow
        label={GBOTS_LABEL}
        collapsed={section.collapsed}
        status={section.headingStatus}
        active={props.containsActive}
        onPress={props.onToggleHeading}
        onMenu={props.onHeadingMenu}
      />
      {section.collapsed ? null : (
        <>
          {section.looseBots.map(botBlock)}
          {section.departments.map((department) => (
            <View key={department.headingKey}>
              <DepartmentRow
                department={department}
                active={department.collapsed && props.departmentActive(department)}
                onPress={() => props.onToggleDepartment(department)}
                onMenu={() => props.onDepartmentMenu(department)}
              />
              {department.collapsed ? null : department.bots.map(botBlock)}
            </View>
          ))}
        </>
      )}
    </View>
  );
}

/** A department's sub-heading: its name in the GBots heading's quiet ink, its dots and count while folded. */
function DepartmentRow({
  department,
  active,
  onPress,
  onMenu,
}: {
  department: GbotsDepartmentModel;
  active: boolean;
  onPress: () => void;
  onMenu: () => void;
}): ReactElement {
  const rowStyles = departmentInkStyles(useSidebarInk());
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: !department.collapsed }}
      accessibilityLabel={`${department.name} department`}
      hitSlop={{ top: ds(4), bottom: ds(4) }}
      style={({ pressed }) => [rowStyles.row, pressed ? rowStyles.rowPressed : null]}
      onPress={onPress}
      onLongPress={onMenu}
    >
      <Text style={rowStyles.label} numberOfLines={1}>
        {department.name}
      </Text>
      {department.collapsed ? (
        <>
          <SectionStatusDots status={department.headingStatus} active={active} />
          <View style={rowStyles.spacer} />
          <Text style={rowStyles.label}>{department.headingStatus.count}</Text>
        </>
      ) : null}
    </Pressable>
  );
}

function GbotRow({
  bot,
  ringColor,
  onToggle,
  onMenu,
}: {
  bot: GbotRowModel;
  ringColor: string;
  onToggle: () => void;
  onMenu: (anchor: MenuAnchor) => void;
}): ReactElement {
  const rowRef = useRef<ViewInstance | null>(null);
  const ink = useSidebarInk();
  const rowStyles = gbotInkStyles(ink);
  const { status } = bot;
  const hasDot =
    status.workingCount > 0 || status.attentionCount > 0 || status.questionCount > 0 || status.approvalCount > 0;
  const computer =
    bot.bot.computer !== undefined && bot.bot.computer.kind !== 'this' && bot.bot.computer.name.length > 0
      ? bot.bot.computer
      : null;
  return (
    <Pressable
      ref={rowRef}
      accessibilityRole="button"
      accessibilityState={{ expanded: !bot.collapsed }}
      accessibilityLabel={bot.bot.title.length > 0 ? `${bot.bot.name}, ${bot.bot.title}` : bot.bot.name}
      onPress={onToggle}
      onLongPress={() => measureInWindow(rowRef, onMenu)}
      style={({ pressed }) => [
        rowStyles.row,
        bot.containsActive ? rowStyles.rowActive : null,
        pressed && !bot.containsActive ? rowStyles.rowPressed : null,
      ]}
    >
      <View pointerEvents="none" style={rowStyles.chevron}>
        <ChevronRightGlyph size={ds(14)} color={ink.muted} rotated={!bot.collapsed} />
      </View>
      <View style={[rowStyles.icon, bot.bot.paused === true ? rowStyles.paused : null]}>
        <GbotIcon icon={bot.bot.icon} color={gbotColorHex(bot.bot.color, bot.bot.colorHex)} size={ds(16)} />
      </View>
      <Text numberOfLines={1} style={rowStyles.title}>
        {bot.bot.name}
      </Text>
      {bot.bot.isLead === true ? (
        <View accessibilityLabel="Leads its department" style={rowStyles.crown}>
          <CrownGlyph size={ds(11)} color={ink.muted} />
        </View>
      ) : null}
      <View style={rowStyles.spacer} />
      {/* Where its chats run when that isn't this computer (server/src/gbots/computer/), as the desktop row shows it. */}
      {computer !== null ? (
        <View style={rowStyles.computer} accessibilityLabel={`Runs on ${computer.name}`}>
          {computer.kind === 'cloudBox' ? (
            <CloudGlyph size={ds(11)} color={ink.muted} />
          ) : (
            <MachinesGlyph size={ds(11)} color={ink.muted} />
          )}
          <Text numberOfLines={1} style={rowStyles.computerName}>
            {computer.name}
          </Text>
        </View>
      ) : null}
      {hasDot ? (
        <StatusDotStack
          workingCount={status.workingCount}
          attentionCount={status.attentionCount}
          questionCount={status.questionCount}
          approvalCount={status.approvalCount}
          backgroundWorkCount={0}
          ringColor={ringColor}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /* A little air above the heading, like the space before a project's Sessions heading. */
  section: {
    paddingTop: ds(4),
  },
  /* A bot's chats sit under its name, like a session group's rows under its header. */
  chats: {
    paddingLeft: ds(14),
  },
});

const gbotInkStyles = inkStyleSheets((ink) =>
  StyleSheet.create({
    /* A session card's box (SessionRow): 44pt, 5px corners, the text where a session's title starts. */
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      height: TOUCH_ROW_HEIGHT,
      paddingLeft: ds(5),
      paddingRight: ds(6),
      gap: ds(8),
      borderRadius: ds(5),
    },
    rowActive: {
      backgroundColor: ink.selected,
    },
    rowPressed: {
      backgroundColor: inkWash(ink, 0.06),
    },
    chevron: {
      width: ds(14),
      alignItems: 'center',
      justifyContent: 'center',
    },
    icon: {
      width: ds(16),
      height: ds(16),
      alignItems: 'center',
      justifyContent: 'center',
    },
    crown: {
      marginLeft: ds(-3),
    },
    spacer: {
      flex: 1,
    },
    computer: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 1,
      maxWidth: ds(110),
      gap: ds(3),
    },
    computerName: {
      flexShrink: 1,
      color: ink.muted,
      fontSize: ds(12),
      lineHeight: ds(16),
    },
    /* A paused GBot's icon dims; its row and chats stay. */
    paused: {
      opacity: 0.45,
    },
    title: {
      flexShrink: 1,
      minWidth: 0,
      color: ink.text,
      fontSize: ds(15.55),
      fontWeight: '300',
      lineHeight: ds(20),
    },
  }),
);

/* A department's sub-heading: the GBots heading's look, a step in and in normal case (rows.tsx SessionKindLabelRow). */
const departmentInkStyles = inkStyleSheets((ink) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: ds(5),
      height: ds(22),
      marginTop: ds(2),
      paddingLeft: ds(9),
      paddingRight: ds(6),
      borderRadius: ds(5),
    },
    rowPressed: {
      backgroundColor: inkWash(ink, 0.06),
    },
    spacer: {
      flex: 1,
    },
    label: {
      color: ink.sectionLabel,
      fontSize: ds(12.5),
      fontWeight: '400',
      lineHeight: ds(16),
    },
  }),
);
