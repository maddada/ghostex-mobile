/**
 * The connect steps the first screen and Add a computer share: three steps with an icon each (get Ghostex on the
 * computer, open Connect a Device there, scan here), Scan the code as the one button, and the small links under it:
 * "Other ways to connect" opens a sheet with Paste a code and Use Tailscale, and the first screen adds the demo.
 * CDXC:RemotePairing 2026-11-10 in copy.ts (`ConnectStartCopy`) has the user's picks.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { ConnectStartCopy } from '../../copy';
import { GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';
import { useAppearance, type Appearance } from '../../theme/useAppearance';
import BottomSheet from '../common/BottomSheet';
import {
  CameraGlyph,
  ChevronRightGlyph,
  DeviceDesktopGlyph,
  DownloadGlyph,
  PasteGlyph,
  QrcodeGlyph,
  ShieldGlyph,
  type SetupGlyphProps,
} from './SetupIcons';
import { SetupButton, useSetupText } from './SetupPrimitives';

const STEP_GLYPHS: Record<(typeof ConnectStartCopy.steps)[number]['key'], ComponentType<SetupGlyphProps>> = {
  install: DownloadGlyph,
  computer: DeviceDesktopGlyph,
  phone: QrcodeGlyph,
};

/** The three steps, each with its icon in a small rounded square. */
export function ConnectSteps() {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  return (
    <View style={styles.steps}>
      {ConnectStartCopy.steps.map((step) => {
        const Glyph = STEP_GLYPHS[step.key];
        return (
          <View key={step.key} style={styles.step}>
            <View style={styles.stepIcon}>
              <Glyph size={17} color={appearance.accent} />
            </View>
            <View style={styles.stepText}>
              <Text style={styles.stepTitle}>{step.title}</Text>
              <Text style={styles.stepDescription}>
                {step.lead}
                {step.link.length > 0 ? (
                  <Text
                    style={styles.link}
                    accessibilityRole="link"
                    onPress={() => void Linking.openURL(ConnectStartCopy.installUrl).catch(() => undefined)}
                  >
                    {step.link}
                  </Text>
                ) : null}
                {step.tail}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export type ConnectActionsProps = {
  onScan: () => void;
  onPaste: () => void;
  onTailscale: () => void;
  /** A last small link beside "Other ways to connect" (the first screen's demo). */
  extraLink?: { label: string; onPress: () => void };
};

/** Scan the code, then the small links; "Other ways to connect" opens its sheet. */
export function ConnectActions({ onScan, onPaste, onTailscale, extraLink }: ConnectActionsProps) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const pick = (open: () => void) => (): void => {
    setSheetOpen(false);
    open();
  };
  return (
    <View style={styles.actions}>
      <SetupButton
        variant="primary"
        large
        label={ConnectStartCopy.scanButton}
        icon={<CameraGlyph size={18} color={appearance.accentForeground} />}
        onPress={onScan}
      />
      <View style={styles.links}>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setSheetOpen(true)}>
          <Text style={styles.smallLink}>{ConnectStartCopy.otherWays}</Text>
        </Pressable>
        {extraLink !== undefined ? (
          <Pressable accessibilityRole="button" hitSlop={8} onPress={extraLink.onPress}>
            <Text style={styles.smallLink}>{extraLink.label}</Text>
          </Pressable>
        ) : null}
      </View>
      <OtherWaysSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onPaste={pick(onPaste)}
        onTailscale={pick(onTailscale)}
      />
    </View>
  );
}

/** "Other ways to connect": Paste a code and Use Tailscale, one row each. */
export function OtherWaysSheet({
  visible,
  onClose,
  onPaste,
  onTailscale,
}: {
  visible: boolean;
  onClose: () => void;
  onPaste: () => void;
  onTailscale: () => void;
}) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const setupText = useSetupText();
  const copy = ConnectStartCopy.otherWaysSheet;
  const rows = [
    { key: 'paste', Glyph: PasteGlyph, ...copy.paste, onPress: onPaste },
    { key: 'tailscale', Glyph: ShieldGlyph, ...copy.tailscale, onPress: onTailscale },
  ];
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={setupText.title}>{copy.title}</Text>
      <View style={styles.sheetRows}>
        {rows.map((row, index) => (
          <Pressable
            key={row.key}
            accessibilityRole="button"
            accessibilityLabel={row.title}
            onPress={row.onPress}
            style={({ pressed }) => [
              styles.sheetRow,
              index === 0 ? styles.sheetRowFirst : null,
              pressed ? styles.sheetRowPressed : null,
            ]}
          >
            <View style={styles.stepIcon}>
              <row.Glyph size={17} color={appearance.accent} />
            </View>
            <View style={styles.stepText}>
              <Text style={styles.stepTitle}>{row.title}</Text>
              <Text style={styles.stepDescription}>{row.detail}</Text>
            </View>
            <ChevronRightGlyph size={16} color={appearance.muted} />
          </Pressable>
        ))}
      </View>
    </BottomSheet>
  );
}

const createStyles = (appearance: Appearance) =>
  StyleSheet.create({
    steps: {
      gap: 16,
    },
    step: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    stepIcon: {
      width: 34,
      height: 34,
      borderRadius: 9,
      backgroundColor: appearance.card,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepText: {
      flex: 1,
      gap: 2,
      paddingTop: 1,
    },
    stepTitle: {
      color: appearance.foreground,
      fontSize: 15,
      fontWeight: '600',
    },
    stepDescription: {
      color: appearance.muted,
      fontSize: 14,
      lineHeight: 20,
    },
    link: {
      color: appearance.accent,
      fontWeight: '600',
    },
    actions: {
      gap: 14,
    },
    links: {
      flexDirection: 'row',
      justifyContent: 'center',
      flexWrap: 'wrap',
      columnGap: 22,
      rowGap: 8,
    },
    smallLink: {
      color: appearance.accent,
      fontSize: 14,
      fontWeight: '500',
      paddingVertical: 4,
    },
    sheetRows: {
      marginTop: 16,
      backgroundColor: appearance.card,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      borderRadius: GhostexRadii.section,
      overflow: 'hidden',
    },
    sheetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderTopWidth: GhostexStrokeWidth,
      borderTopColor: appearance.border,
    },
    sheetRowFirst: {
      borderTopWidth: 0,
    },
    sheetRowPressed: {
      backgroundColor: appearance.cardActive,
    },
  });
