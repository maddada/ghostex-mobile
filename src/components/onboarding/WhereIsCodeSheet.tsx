/**
 * "Where is the code?" help sheet (mobile-03-scan.html, `.where-is-code-sheet`),
 * behind the "?" header button and the "Show me where it is" link. Static
 * copy written for someone standing at the computer.
 */

import { Linking, StyleSheet, Text, View } from 'react-native';

import { ScanCopy } from '../../copy';
import { GhostexRadii, GhostexStrokeWidth, SetupPalette } from '../../theme/palette';
import BottomSheet from '../common/BottomSheet';
import { StepNumber, setupText } from './SetupPrimitives';

export type WhereIsCodeSheetProps = {
  visible: boolean;
  onClose: () => void;
};

export default function WhereIsCodeSheet({ visible, onClose }: WhereIsCodeSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={setupText.title}>{ScanCopy.whereIsCode.title}</Text>
      <View style={styles.steps}>
        {ScanCopy.whereIsCode.steps.map((step, index) => (
          <View key={step.title} style={[styles.step, index === 0 ? styles.stepFirst : null]}>
            <StepNumber number={index + 1} />
            <View style={styles.stepBody}>
              <Text style={styles.stepTitle}>{step.title}</Text>
              <Text style={styles.stepDetail}>{step.detail}</Text>
            </View>
          </View>
        ))}
      </View>
      <Text style={[setupText.small, setupText.dim, setupText.center, styles.footnote]}>
        {ScanCopy.whereIsCode.notInstalledPrefix}
        <Text
          style={setupText.accent}
          onPress={() => void Linking.openURL(ScanCopy.whereIsCode.notInstalledUrl).catch(() => undefined)}
        >
          {ScanCopy.whereIsCode.notInstalledLink}
        </Text>
      </Text>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  steps: {
    marginTop: 16,
    backgroundColor: SetupPalette.CARD,
    borderWidth: GhostexStrokeWidth,
    borderColor: SetupPalette.BORDER,
    borderRadius: GhostexRadii.section,
    overflow: 'hidden',
  },
  step: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: GhostexStrokeWidth,
    borderTopColor: SetupPalette.BORDER,
  },
  stepFirst: {
    borderTopWidth: 0,
  },
  stepBody: {
    flex: 1,
    gap: 3,
  },
  stepTitle: {
    color: SetupPalette.FOREGROUND,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 19,
  },
  stepDetail: {
    color: SetupPalette.MUTED,
    fontSize: 13,
    lineHeight: 18,
  },
  footnote: {
    marginTop: 16,
  },
});
