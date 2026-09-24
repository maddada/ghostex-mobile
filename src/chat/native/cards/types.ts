/**
 * What a card asks of the app shell rather than of the chat core, named like desktop's
 * `sessionChatHostAction` messages: `terminalView` (show the session's terminal) and
 * `switchAccount` (open the accounts panel the notice's Switch account button opens on desktop).
 */
export type CardHostAction = (action: 'terminalView' | 'switchAccount', params?: Record<string, unknown>) => void;
