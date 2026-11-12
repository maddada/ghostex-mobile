/**
 * The terminal screen's chat: the real Rust chat for a paired computer, and the
 * bundled demo transcript for the sample computer.
 */

import { memo } from 'react';

import NativeChatScreen, { type NativeChatScreenProps } from '../chat/native/NativeChatScreen';
import { isDemoMachine } from './identity';
import DemoChatView from './DemoChatView';

/**
 * Memoized: the terminal screen renders a few times per tab change and on every session list read, and the selected
 * tab's chat is given props that keep their identity (TerminalScreen), so those renders skip the chat.
 */
export default memo(function SessionChatSurface(props: NativeChatScreenProps) {
  if (isDemoMachine(props.machine)) {
    return <DemoChatView sessionId={props.sessionId} visible={props.visible} style={props.style} />;
  }
  return <NativeChatScreen {...props} />;
});
