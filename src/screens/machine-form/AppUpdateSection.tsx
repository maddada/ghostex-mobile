/**
 * Edit machine's Ghostex block: the version that computer runs and what its updater is doing, the
 * action (Update to <version>, Check for updates, Retry), and the "Keep this machine up to date"
 * switch, the desktop's machine dialog row (`dialog_update_section`) on the phone.
 */

import { readableSecondaryText } from '../../theme/sidebarAppearance';
import { useAppearance } from '../../theme/useAppearance';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Switch, Text, View } from 'react-native';

import { SetupButton } from '../../components/onboarding/SetupPrimitives';
import { CopyGlyph, DownloadGlyph, RefreshGlyph } from '../../components/sessions/icons';
import { EditMachineCopy } from '../../copy';
import {
  appUpdateView,
  runAppUpdateOp,
  setAppAutoUpdate,
  useAppUpdateStore,
  type AppUpdateView,
} from '../../machines/appUpdate';
import { SwitchRow } from '../../components/common/SwitchRow';
import type { MachineConnectionTarget } from '../../machines/credentials';
import { SetupPalette } from '../../theme/palette';
import { useFormStyles } from './styles';

const TONE_COLOR: Record<AppUpdateView['tone'], string> = {
  muted: SetupPalette.MUTED,
  warning: SetupPalette.WARN,
  success: SetupPalette.OK,
};

export default function AppUpdateSection({ machine }: { machine: MachineConnectionTarget }) {
  const appearance = useAppearance();
  const formStyles = useFormStyles();
  const update = useAppUpdateStore((state) => state.byMachineId[machine.id]);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  if (update === undefined) return null;
  const view = appUpdateView(update);
  const copy = EditMachineCopy.appUpdate;
  const line =
    [view.versionText, view.detail].filter((part): part is string => part !== null).join(' · ') ||
    (view.busy ? copy.reading : null);
  if (line === null) return null;
  const action = view.action;
  return (
    <>
      <Text style={formStyles.sectionLabel}>{copy.label}</Text>
      <View style={formStyles.rowsCard}>
        <View style={[formStyles.row, formStyles.rowFirst]}>
          {view.busy ? <ActivityIndicator size="small" color={appearance.muted} /> : null}
          <View style={formStyles.rowMain}>
            <Text style={[formStyles.rowDetail, { color: readableSecondaryText(TONE_COLOR[view.tone], appearance.foreground, [appearance.background, appearance.card, appearance.cardActive]) }]}>{line}</Text>
          </View>
        </View>
        {view.linux !== null && view.linux.command !== null ? (
          <View style={[formStyles.row, { paddingTop: 2, borderTopWidth: 0 }]}>
            <Text
              selectable
              style={[
                formStyles.rowDetail,
                formStyles.rowDetailMono,
                {
                  flex: 1,
                  color: appearance.foreground,
                  backgroundColor: appearance.cardActive,
                  borderRadius: 8,
                  padding: 10,
                },
              ]}
            >
              {view.linux.command}
            </Text>
          </View>
        ) : null}
        {view.linux !== null && (view.linux.command !== null || view.linux.releaseUrl !== null) ? (
          <View style={[formStyles.row, { paddingTop: 2, borderTopWidth: 0, gap: 8 }]}>
            {view.linux.command !== null ? (
              <SetupButton
                small
                label={copied ? copy.copied : copy.copyCommand}
                icon={<CopyGlyph size={14} color={appearance.foreground} />}
                onPress={() => {
                  const command = view.linux?.command;
                  if (command != null) void Clipboard.setStringAsync(command).then(() => setCopied(true));
                }}
              />
            ) : null}
            {view.linux.releaseUrl !== null ? (
              <SetupButton
                small
                label={copy.releasePage}
                onPress={() => {
                  const url = view.linux?.releaseUrl;
                  if (url != null) void Linking.openURL(url).catch(() => undefined);
                }}
              />
            ) : null}
          </View>
        ) : null}
        {action !== null ? (
          <View style={[formStyles.row, { paddingTop: 2, borderTopWidth: 0 }]}>
            <SetupButton
              small
              label={action.label}
              disabled={!action.enabled}
              icon={
                action.op === 'install' ? (
                  <DownloadGlyph size={14} color={appearance.foreground} />
                ) : (
                  <RefreshGlyph size={14} color={appearance.foreground} />
                )
              }
              onPress={() => runAppUpdateOp(machine, action.op)}
            />
          </View>
        ) : null}
        {view.autoUpdate !== null ? (
          <SwitchRow
            value={view.autoUpdate}
            disabled={update.busy}
            onValueChange={(enabled) => setAppAutoUpdate(machine, enabled)}
            label={copy.autoUpdate}
            style={formStyles.row}
          >
            <View style={formStyles.rowMain}>
              <Text style={formStyles.rowLabel}>{copy.autoUpdate}</Text>
              <Text style={formStyles.rowDetail}>{copy.autoUpdateDetail}</Text>
            </View>
            <Switch
              value={view.autoUpdate}
              disabled={update.busy}
              onValueChange={(enabled) => setAppAutoUpdate(machine, enabled)}
              trackColor={{ false: appearance.cardActive, true: appearance.accent }}
              thumbColor={appearance.foreground}
            />
          </SwitchRow>
        ) : null}
      </View>
    </>
  );
}
