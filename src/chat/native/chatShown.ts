/**
 * Whether the chat these views belong to is on screen. False for a chat kept mounted out of sight: the selected
 * session's chat while its terminal shows, and the chats of the other recent tabs kept warm (`WarmChats.tsx`). Views
 * that animate forever (the working spinners and sweeps, a running tool's shimmer, the loading skeleton's pulse) stop
 * while it is false, so the chats nobody sees cost no frames; they start again when the chat is shown.
 */

import { createContext, useContext } from 'react';

export const ChatShownContext = createContext(true);

export function useChatShown(): boolean {
  return useContext(ChatShownContext);
}
