/**
 * Static image module declaration for the onboarding screens (the project has
 * no generated expo-env.d.ts, so `.png` imports need a local declaration).
 */
declare module '*.png' {
  import type { ImageSourcePropType } from 'react-native';

  const source: ImageSourcePropType;
  export default source;
}
