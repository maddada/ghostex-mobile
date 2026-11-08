/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. The same tests as `AttentionListScreen.rntl.tsx`, with React Native reporting Android,
 * so the bell's screen and its Clear Done behave the same on both platforms (ghostex-mobile#29; user: "i dont want
 * android and ios experience to diverge in terms of behavior").
 */

import { Platform } from 'react-native';

jest.replaceProperty(Platform, 'OS', 'android');
require('./AttentionListScreen.rntl');
