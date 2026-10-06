/** The agent marks' accent colors (`workspace_tab_agent_icon_accent_color` on desktop). */
const ACCENTS: Record<string, string> = {
  'amp-cli': '#ffffff',
  'antigravity-cli': '#749bff',
  browser: '#82b7ff',
  claude: '#d97757',
  codebuddy: '#72d6ff',
  'command-code': '#22d3ee',
  'cursor-cli': '#edecec',
  codex: '#ffffff',
  copilot: '#ffffff',
  devin: '#3ea6ff',
  empryo: '#1fa31d',
  'factory-droid': '#ff7a1a',
  gemini: '#8b9aff',
  'grok-build': '#ffffff',
  'hermes-agent': '#f3c46b',
  kimi: '#7b6cf6',
  kiro: '#a6e3ff',
  omp: '#c8ff62',
  openclaude: '#f0a68a',
  opencode: '#6d96c0',
  pi: '#c8ff62',
  qoder: '#a991ff',
  'rovo-dev': '#4fc3a1',
};

/** The white and near-white marks take the foreground on the light chat (`brand_logo_color`). */
export function agentAccent(icon: string, light: boolean): string {
  const accent = ACCENTS[icon] ?? '#ffffff';
  return light && (accent === '#ffffff' || accent === '#edecec') ? '#27272a' : accent;
}
