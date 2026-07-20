import { requireNativeView } from 'expo';
import * as React from 'react';

import type { GhostexTerminalViewProps } from './GhostexNative.types';

const NativeView: React.ComponentType<GhostexTerminalViewProps> =
  requireNativeView('GhostexNative', 'GhostexTerminalView');

export default function GhostexTerminalView(props: GhostexTerminalViewProps) {
  return <NativeView {...props} />;
}
