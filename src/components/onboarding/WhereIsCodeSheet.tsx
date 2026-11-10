/**
 * "Where is the code?" help sheet (mobile-03-scan.html, `.where-is-code-sheet`),
 * behind the "?" header button and the "Show me where it is" link. Static
 * copy written for someone standing at the computer.
 */

import { Linking, Text } from 'react-native';

import { ScanCopy } from '../../copy';
import SetupStepsSheet from './SetupStepsSheet';
import { useSetupText } from './SetupPrimitives';

export type WhereIsCodeSheetProps = {
  visible: boolean;
  onClose: () => void;
};

export default function WhereIsCodeSheet({ visible, onClose }: WhereIsCodeSheetProps) {
  const setupText = useSetupText();
  return (
    <SetupStepsSheet
      visible={visible}
      onClose={onClose}
      title={ScanCopy.whereIsCode.title}
      steps={ScanCopy.whereIsCode.steps}
      footer={
        <Text style={[setupText.small, setupText.dim, setupText.center]}>
          {ScanCopy.whereIsCode.notInstalledPrefix}
          <Text
            style={setupText.accent}
            onPress={() => void Linking.openURL(ScanCopy.whereIsCode.notInstalledUrl).catch(() => undefined)}
          >
            {ScanCopy.whereIsCode.notInstalledLink}
          </Text>
        </Text>
      }
    />
  );
}
