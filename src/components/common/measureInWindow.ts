/**
 * A pressed button's frame in window points, for the menu it opens (ContextMenu's `anchor`).
 */

import type { RefObject } from 'react';
import type { ViewInstance } from 'react-native';

import type { WindowRect } from '../../../modules/ghostex-native/src/GhostexNative.types';

/** Measures the view behind `ref` and reports its window frame; nothing while it is not mounted. */
export function measureInWindow(ref: RefObject<ViewInstance | null>, onFrame: (frame: WindowRect) => void): void {
  const node = ref.current;
  if (node === null) return;
  node.measureInWindow((x, y, width, height) => onFrame({ x, y, width, height }));
}
