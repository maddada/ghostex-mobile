/**
 * An agent's brand mark in its own color, as desktop's `brand_logo_color` paints it
 * (`workspace_tab_agent_icon_accent_color`), or the generic robot when the agent has no artwork.
 */

import { AGENT_ICONS } from '../../../assets/agentIcons.generated';
import { Glyph } from './icons';
import { ChatCardPalette as P } from './palette';

const ACCENTS: Record<string, string> = {
  'antigravity-cli': '#749bff',
  browser: '#82b7ff',
  claude: '#d97757',
  codebuddy: '#72d6ff',
  'cursor-cli': '#edecec',
  'factory-droid': '#ff7a1a',
  gemini: '#8b9aff',
  'hermes-agent': '#f3c46b',
  kiro: '#a6e3ff',
  omp: '#c8ff62',
  openclaude: '#f0a68a',
  opencode: '#6d96c0',
  pi: '#c8ff62',
  qoder: '#a991ff',
  'rovo-dev': '#4fc3a1',
};

export function AgentMark({ icon, size }: { icon: string | null | undefined; size: number }) {
  const Icon = icon ? AGENT_ICONS[icon] : undefined;
  if (Icon === undefined) return <Glyph name="robot" size={size} color={P.foreground} />;
  return <Icon size={size} color={ACCENTS[icon ?? ''] ?? P.foreground} />;
}
