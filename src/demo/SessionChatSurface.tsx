/**
 * The terminal screen's chat: the real Rust chat for a paired computer, and the
 * bundled demo transcript for the sample computer.
 */

import NativeChatScreen, { type NativeChatScreenProps } from '../chat/native/NativeChatScreen';
import { isDemoMachine } from './identity';
import DemoChatView from './DemoChatView';

export default function SessionChatSurface(props: NativeChatScreenProps) {
  if (isDemoMachine(props.machine)) {
    return <DemoChatView sessionId={props.sessionId} visible={props.visible} style={props.style} />;
  }
  return <NativeChatScreen {...props} />;
}
