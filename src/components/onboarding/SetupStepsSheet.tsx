/**
 * A help sheet of numbered steps for someone standing at the computer: "Where is the code?" on the scanner and
 * "The computer shows nothing?" while the phone waits for Approve.
 */

import { useMemo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';
import { useAppearance, type Appearance } from '../../theme/useAppearance';
import BottomSheet from '../common/BottomSheet';
import { StepNumber, useSetupText } from './SetupPrimitives';

export type SetupStepsSheetProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  steps: readonly { title: string; detail: string }[];
  /** A line under the steps. */
  footer?: ReactNode;
};

export default function SetupStepsSheet({ visible, onClose, title, steps, footer }: SetupStepsSheetProps) {
  const setupText = useSetupText();
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={setupText.title}>{title}</Text>
      <View style={styles.steps}>
        {steps.map((step, index) => (
          <View key={step.title} style={[styles.step, index === 0 ? styles.stepFirst : null]}>
            <StepNumber number={index + 1} />
            <View style={styles.stepBody}>
              <Text style={styles.stepTitle}>{step.title}</Text>
              <Text style={styles.stepDetail}>{step.detail}</Text>
            </View>
          </View>
        ))}
      </View>
      {footer !== undefined ? <View style={styles.footnote}>{footer}</View> : null}
    </BottomSheet>
  );
}

const createStyles = (appearance: Appearance) => StyleSheet.create({
  steps: {
    marginTop: 16,
    backgroundColor: appearance.card,
    borderWidth: GhostexStrokeWidth,
    borderColor: appearance.border,
    borderRadius: GhostexRadii.section,
    overflow: 'hidden',
  },
  step: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: GhostexStrokeWidth,
    borderTopColor: appearance.border,
  },
  stepFirst: {
    borderTopWidth: 0,
  },
  stepBody: {
    flex: 1,
    gap: 3,
  },
  stepTitle: {
    color: appearance.foreground,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 19,
  },
  stepDetail: {
    color: appearance.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  footnote: {
    marginTop: 16,
  },
});
