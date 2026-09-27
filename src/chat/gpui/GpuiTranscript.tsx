/**
 * Where GPUI draws the conversation: the desktop's own chat transcript, in the space the React
 * Native transcript takes otherwise. Its events go to the open chat's `GpuiChatHost`.
 */
import type { StyleProp, ViewStyle } from 'react-native';

import { GpuiView } from '../../../modules/gx-chat-core/src/gpui';
import { dispatchGpuiEvent } from './GpuiChatHost';

export default function GpuiTranscript({ style }: { style?: StyleProp<ViewStyle> }) {
  return <GpuiView style={style} onEvent={dispatchGpuiEvent} />;
}
