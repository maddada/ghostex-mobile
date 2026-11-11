/**
 * Settings > Notifications (was Sounds; the notifications design, states settings,
 * settings-master-off, settings-denied): one master switch and one each for finished, waiting and
 * error, the delivery limit without push in words (no promise for a locked or
 * paused phone), and the attention sound that was this page's only row before. With the master off the
 * three stay visible and keep their values, dimmed. When iOS blocks notifications the page says so
 * and leads to iOS Settings, because iOS asks only once.
 * Agent notifications are iOS only; on Android the page keeps the sound.
 *
 * The delivery text follows what the app knows: while an enabled computer confirmed it accepted this phone's push
 * registration, and while the stored record that says so is not read yet, it says a computer that accepted this
 * iPhone can also notify while Ghostex is closed, with no promise that a push arrives; otherwise the text for a
 * running app.
 */

import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { SwitchRow as RowToggle } from '../../components/common/SwitchRow';
import { NotificationChoicesCopy, NotificationsCopy } from '../../copy';
import { enabledMachines, useMachinesStore } from '../../machines/store';
import {
  askForNotificationsOnce,
  refreshNotificationPermission,
  useAttentionFeedStore,
} from '../../notifications/feedStore';
import { BellOffGlyph } from '../../notifications/icons';
import { NOTIFICATIONS_SUPPORTED, postTestNotification } from '../../notifications/notificationCentre';
import {
  type AlertChoice,
  type AlertKindKey,
  type NotificationSettings,
  withAlertChoices,
} from '../../notifications/settings';
import { useSettingsStore } from '../../settings/store';
import { BLOCKED_CARD_WASH, colorOver, neutralButtonFills } from '../../theme/palette';
import { readableSecondaryText } from '../../theme/sidebarAppearance';
import { useAppearance } from '../../theme/useAppearance';
import {
  Caption,
  SectionHeader,
  SegmentedRow,
  SettingsScreenLayout,
  SettingToggle,
  useSettingsStyles,
} from './SettingsControls';

/** The choice rows, in the page's order: what needs you first, then the turns you wait for, errors, thread reports. */
const KIND_ROWS: readonly { key: AlertKindKey; label: string; detail: string }[] = [
  { key: 'needsYou', label: NotificationChoicesCopy.needsYou, detail: NotificationChoicesCopy.needsYouDetail },
  { key: 'finished', label: NotificationChoicesCopy.finished, detail: NotificationChoicesCopy.finishedDetail },
  { key: 'errors', label: NotificationChoicesCopy.errors, detail: NotificationChoicesCopy.errorsDetail },
  {
    key: 'threadReports',
    label: NotificationChoicesCopy.threadReports,
    detail: NotificationChoicesCopy.threadReportsDetail,
  },
];

const CHOICE_OPTIONS: readonly { value: AlertChoice; label: string }[] = [
  { value: 'sound', label: NotificationChoicesCopy.choiceSound },
  { value: 'silent', label: NotificationChoicesCopy.choiceSilent },
  { value: 'off', label: NotificationChoicesCopy.choiceOff },
];

/** One kind: its name and what it covers, over Sound, Silent and Off; dimmed and inert while the master is off. */
function KindChoice({
  label,
  detail,
  value,
  disabled,
  onChange,
}: {
  label: string;
  detail: string;
  value: AlertChoice;
  disabled: boolean;
  onChange: (value: AlertChoice) => void;
}) {
  const styles = useSettingsStyles();
  const appearance = useAppearance();
  return (
    <View
      style={[styles.card, disabled && styles.rowDisabled]}
      pointerEvents={disabled ? 'none' : 'auto'}
      accessibilityState={{ disabled }}
    >
      <View style={local.kindText}>
        <Text style={styles.cardLabel}>{label}</Text>
        <Text style={[local.detail, { color: appearance.muted }]}>{detail}</Text>
      </View>
      <SegmentedRow label={label} options={CHOICE_OPTIONS} value={value} onChange={onChange} />
    </View>
  );
}

/** Settings › Notifications › Send a test notification: a local notice in 5 seconds, with Needs you's sound. */
function TestNotification({ settings }: { settings: NotificationSettings }) {
  const styles = useSettingsStyles();
  const [outcome, setOutcome] = useState<'sent' | 'failed' | null>(null);
  const send = () => {
    const copy = NotificationChoicesCopy;
    void postTestNotification(copy.testTitle, copy.testBody, settings.choices.needsYou === 'sound')
      .then(() => setOutcome('sent'))
      .catch(() => setOutcome('failed'));
  };
  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={send}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <Text style={styles.rowLabel}>{NotificationChoicesCopy.test}</Text>
      </Pressable>
      {outcome !== null ? (
        <Caption>{outcome === 'sent' ? NotificationChoicesCopy.testSent : NotificationChoicesCopy.testFailed}</Caption>
      ) : null}
    </>
  );
}

/** A Settings switch row that dims while disabled, on the shared row so a tap anywhere on it toggles. */
function SwitchRow({
  label,
  detail,
  value,
  disabled = false,
  onValueChange,
}: {
  label: string;
  detail?: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const styles = useSettingsStyles();
  const appearance = useAppearance();
  return (
    <RowToggle
      value={value}
      disabled={disabled}
      onValueChange={onValueChange}
      label={label}
      style={[styles.row, disabled && styles.rowDisabled]}
      pressedStyle={styles.rowPressed}
    >
      <View style={local.label}>
        <Text style={styles.cardLabel}>{label}</Text>
        {detail !== undefined ? <Text style={[local.detail, { color: appearance.muted }]}>{detail}</Text> : null}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ false: appearance.control, true: appearance.accent }}
        thumbColor={value ? appearance.foreground : appearance.controlThumb}
        ios_backgroundColor={appearance.control}
      />
    </RowToggle>
  );
}

function BlockedCard() {
  const appearance = useAppearance();
  const fills = neutralButtonFills(appearance.light);
  const copy = NotificationsCopy.settings;
  const surface = colorOver(BLOCKED_CARD_WASH, appearance.background);
  const buttonInk = readableSecondaryText(appearance.foreground, appearance.light ? '#000000' : '#ffffff', [
    colorOver(fills.rest, surface),
    colorOver(fills.pressed, surface),
  ]);
  // The secondary text sits on the red wash, not on the page: it keeps 4.5:1 on the wash it is drawn on.
  const detail = readableSecondaryText(appearance.muted, appearance.foreground, [surface]);
  return (
    <View accessibilityRole="alert" style={[local.blocked, { backgroundColor: BLOCKED_CARD_WASH }]}>
      <BellOffGlyph size={20} color={appearance.danger} />
      <View style={local.blockedText}>
        <Text style={[local.blockedTitle, { color: appearance.foreground }]}>{copy.blockedTitle}</Text>
        <Text style={[local.detail, { color: detail }]}>{copy.blockedText}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void Linking.openSettings()}
          style={({ pressed }) => [local.blockedButton, { backgroundColor: pressed ? fills.pressed : fills.rest }]}
        >
          <Text style={[local.blockedButtonText, { color: buttonInk }]}>{copy.openSettings}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function AgentNotifications() {
  const notifications = useSettingsStore((state) => state.settings.notifications);
  const setSetting = useSettingsStore((state) => state.setSetting);
  const permission = useAttentionFeedStore((state) => state.permission);
  const pushComputers = useAttentionFeedStore((state) => state.pushComputers);
  const machines = useMachinesStore((state) => state.machines);
  const pushing =
    pushComputers === null || enabledMachines({ machines }).some((machine) => pushComputers.includes(machine.id));
  const copy = NotificationsCopy.settings;

  useFocusEffect(
    useCallback(() => {
      void refreshNotificationPermission();
    }, []),
  );

  const set = (next: Partial<NotificationSettings>) => setSetting('notifications', { ...notifications, ...next });
  const setMaster = (on: boolean) => {
    // Turned on before the one-time ask ever ran (it was dismissed): this is the ask.
    if (on && notifications.askedAt === undefined) void askForNotificationsOnce();
    else set({ enabled: on });
  };
  const choose = (key: AlertKindKey, choice: AlertChoice) =>
    setSetting('notifications', withAlertChoices(notifications, { ...notifications.choices, [key]: choice }));

  return (
    <>
      {permission === 'denied' ? <BlockedCard /> : null}
      <SectionHeader title={copy.sectionAgents} />
      <SwitchRow label={copy.master} value={notifications.enabled} onValueChange={setMaster} />
      <Caption>{pushing ? NotificationChoicesCopy.pushCaption : copy.limit}</Caption>
      <SectionHeader title={NotificationChoicesCopy.sectionKinds} />
      {KIND_ROWS.map((row) => (
        <KindChoice
          key={row.key}
          label={row.label}
          detail={row.detail}
          value={notifications.choices[row.key]}
          disabled={!notifications.enabled}
          onChange={(choice) => choose(row.key, choice)}
        />
      ))}
      <Caption>{NotificationChoicesCopy.kindsCaption}</Caption>
      <Caption>{NotificationChoicesCopy.quietHours}</Caption>
      {notifications.enabled ? <TestNotification settings={notifications} /> : null}
    </>
  );
}

function AlertsFor() {
  const copy = NotificationsCopy.settings;
  const alertsFor = useSettingsStore((state) => state.settings.attentionAlertsFor);
  const setSetting = useSettingsStore((state) => state.setSetting);
  return (
    <>
      <SegmentedRow
        label={copy.alertsFor}
        options={[
          { value: 'all', label: copy.alertsForAll },
          { value: 'needsYou', label: copy.alertsForNeedsYou },
        ]}
        value={alertsFor}
        onChange={(next) => setSetting('attentionAlertsFor', next)}
      />
      <Caption>{copy.alertsForDetail}</Caption>
    </>
  );
}

export default function NotificationsPage() {
  const copy = NotificationsCopy.settings;
  return (
    <SettingsScreenLayout>
      {NOTIFICATIONS_SUPPORTED ? <AgentNotifications /> : null}
      {NOTIFICATIONS_SUPPORTED ? <SectionHeader title={copy.sectionSound} /> : null}
      <SettingToggle settingKey="doneNotificationSound" label={copy.sound} />
      <Caption>{copy.soundDetail}</Caption>
      <AlertsFor />
    </SettingsScreenLayout>
  );
}

const local = StyleSheet.create({
  label: { flex: 1, gap: 2, paddingVertical: 4 },
  detail: { fontSize: 12 },
  kindText: { gap: 2 },
  blocked: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 8 },
  blockedText: { flex: 1, minWidth: 0, gap: 4, alignItems: 'flex-start' },
  blockedTitle: { fontSize: 14, fontWeight: '600' },
  blockedButton: { marginTop: 8, minHeight: 44, paddingHorizontal: 14, borderRadius: 8, justifyContent: 'center' },
  blockedButtonText: { fontSize: 14, fontWeight: '600' },
});
