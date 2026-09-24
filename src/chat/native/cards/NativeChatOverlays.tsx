/**
 * Everything the chat draws over itself: the account-switch card (inside the chat, over the
 * transcript and the composer), and the subagent viewer, the image viewer and the table preview
 * (full-screen modals). Mount it last inside the chat's root view so the account-switch card can
 * cover the chat; it takes no space and no touches of its own.
 */

import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import type { RustChat } from '../../rust/useRustChat';
import { AccountSwitchCard } from './AccountSwitchCard';
import { ImageViewer } from './ImageViewer';
import { closeChatOverlays } from './overlayStore';
import { SubagentViewer, type TranscriptItemRenderer } from './SubagentViewer';
import { TablePreview } from './TablePreview';

export type NativeChatOverlaysProps = {
  chat: RustChat;
  /** The transcript's row renderer, so the subagent viewer's rows read like the main list. */
  renderTranscriptItem?: TranscriptItemRenderer;
};

export function NativeChatOverlays({ chat, renderTranscriptItem }: NativeChatOverlaysProps) {
  // The previews belong to the chat on screen: leaving it closes them, as desktop takes a pane's
  // previews down when the user switches to another session.
  useEffect(() => closeChatOverlays, []);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <AccountSwitchCard chat={chat} />
      <SubagentViewer chat={chat} renderItem={renderTranscriptItem} />
      <ImageViewer chat={chat} />
      <TablePreview />
    </View>
  );
}
