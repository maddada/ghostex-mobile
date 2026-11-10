/**
 * User-facing words for the offline demo computer. Kept here so the setup
 * screens, the session list and Settings say the same thing.
 */

export const DemoCopy = {
  entryTitle: 'Try a demo computer',
  entryButton: 'Open demo',
  welcomeButton: 'Try a demo computer',
  banner:
    'Sample computer on this phone. Nothing here is a real machine, and nothing is sent over the network.',
  cardDetail: 'Sample projects on this phone. No network.',
  chatNote: 'Demo chat. Replies are written in advance and stay on this phone.',
  terminalNote: 'Demo terminal. The output is a recording, not a live shell.',
  previewTitle: 'Atlas API',
  voiceNote:
    'Voice is off for the demo computer. Dictate and the voice agent need a real computer. The demo never uses the microphone or the network.',
  liveActivityNote:
    'The demo computer can appear here from its sample sessions. That stays on this phone and does not connect to anything.',
  settingsTitle: 'Demo computer',
  settingsDescription: 'The sample computer on this phone, and how to remove it.',
  settingsIntro:
    'Demo computer is a sample machine stored on this phone. Its projects, sessions, chat, terminal and preview are bundled with the app. It never pairs, never signs in, and never uses the network. Your real computers are unchanged.',
  remove: 'Remove demo computer',
  formTitle: 'Demo computer',
  formBody:
    'This machine is sample data saved in the app so you can browse sessions, send a message, open a terminal and look at a preview without pairing a computer. Remove it when you are done. Pairing a real computer is separate and is not affected.',
  newSessionWelcome: (project: string) =>
    `New session in ${project}. Send a message and I'll answer with a scripted reply. No model runs, and nothing leaves this phone.`,
} as const;
