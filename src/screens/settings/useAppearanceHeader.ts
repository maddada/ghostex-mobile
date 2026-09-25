import { useLayoutEffect } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../navigation/types';
import { useAppearance, type Appearance } from '../../theme/useAppearance';

/**
 * Paints the calling screen's navigation header and scene with the current
 * appearance and repaints them whenever tint or contrast change. The layout
 * effect applies the colors before the pushed screen is first drawn.
 */
export function useAppearanceHeader(): Appearance {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const appearance = useAppearance();
  useLayoutEffect(() => {
    navigation.setOptions({
      headerStyle: { backgroundColor: appearance.background },
      headerTintColor: appearance.foreground,
      contentStyle: { backgroundColor: appearance.background },
    });
  }, [navigation, appearance]);
  return appearance;
}
