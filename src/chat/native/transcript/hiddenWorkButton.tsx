/**
 * Agent work set to Quiet (`chatLook.agentWork` `quiet`, gx-chat-core `transcript/chat_look.rs`):
 * what the reply that carries a `grouped-work` row's work reads while drawing (the row itself is
 * `hiddenWork.tsx`). The work is a button on the left of the time row of the reply the core names
 * (`workCarrier`): "✓ 24s · 5 tools · 2 files ›", the core's `workButton`, which opens the steps
 * under it. The core already moved every reply's calls into the work and left the running turn's
 * out (`grouped_work::hide_work`). Port of desktop `hidden_work.rs`.
 *
 * CDXC:SessionChat 2026-11-07 SEE-ALSO:
 * packages/gx-chat-core/src/transcript/chat_look.rs (the user decision), apps/desktop/src/app/native_chat/hidden_work.rs (the desktop draws the same button).
 */

import { createContext, useContext, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useTranscriptEnv } from './context';
import { Glyph } from './icons';
import { FOOTER_DIM } from './messageSpacing';
import { successTone, type QuietMark } from './quietWork';

/** The work of one `grouped-work` row, waiting for the reply whose time row shows its button. */
export type HiddenWork = {
  /** The id of the reply that carries the button (the core's `workCarrier`); null draws it on a row of its own. */
  carrier: string | null;
  label: string;
  mark: QuietMark;
  open: boolean;
  expandable: boolean;
  toggle(): void;
  /** The opened steps, drawn right under the reply's time row. */
  steps: ReactNode;
};

const HiddenWorkContext = createContext<HiddenWork | null>(null);
export const HiddenWorkProvider = HiddenWorkContext.Provider;

/** The work `id` carries, when it is the reply that shows the button. */
export function useHiddenWorkFor(id: string): HiddenWork | null {
  const work = useContext(HiddenWorkContext);
  return work !== null && work.carrier === id ? work : null;
}

/** The work button: the check (the cross when a call failed), the core's `workButton`, and a chevron. */
export function WorkButton({ work, height }: { work: HiddenWork; height: number }) {
  const { theme } = useTranscriptEnv();
  const rest = theme.mutedInk(FOOTER_DIM);
  return (
    <Pressable
      disabled={!work.expandable}
      onPress={work.toggle}
      accessibilityRole="button"
      accessibilityLabel={`Show what the agent did: ${work.label}`}
      accessibilityState={work.expandable ? { expanded: work.open } : undefined}
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => [
        styles.button,
        { height },
        (pressed || work.open) && { backgroundColor: theme.ink(0.05) },
      ]}
    >
      {({ pressed }) => {
        const tone = pressed || work.open ? theme.muted : rest;
        return (
          <>
            {work.mark === 'failed' ? (
              <Glyph name="x" size={12} color={theme.error} />
            ) : (
              <Glyph name="check" size={12} color={successTone(theme.light)} />
            )}
            <Text numberOfLines={1} style={[styles.label, { color: tone }]}>
              {work.label}
            </Text>
            <Glyph name={work.open ? 'chevron-down' : 'chevron-right'} size={12} color={tone} />
          </>
        );
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 6,
    marginLeft: -6,
    borderRadius: 4,
    flexShrink: 1,
    minWidth: 0,
  },
  label: { fontSize: 12, flexShrink: 1 },
});
