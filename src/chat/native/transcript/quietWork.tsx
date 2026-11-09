/**
 * The quiet style Agent work Reduced and Quiet draw the agent's work in (`chatLook.agentWork`,
 * gx-chat-core `transcript/chat_look.rs`): small dim lines instead of cards. A work line (clock,
 * green check, "Worked for 1m 16s · 9 tool calls · edited 2 files +14 −3"), the running turn's live
 * lines ("Working · 3 tool calls…", an edit line with a pencil, "Edited 2 files +14 −3 migrate.ts,
 * staging.yml") and, once a line is opened, its steps on a thin rail, one per call. At Default
 * nothing here runs. Port of desktop `quiet_work.rs`, with its sizes, colours and spacing; the rows
 * that use these are `quietWorkRows.tsx`, `hiddenWork.tsx`, `ToolRows.tsx` and `MessageRow.tsx`.
 *
 * Agent work Reduced draws everything the agent did for one message of yours as one dim line ("Worked for 1m 16s · 9 tool calls · edited 2 files +14 −3"), with no fill, border or radius, and the agent's messages after it; opening the line lists its calls on a thin rail, one per line, and opening one shows today's detail. The running turn's "N tool calls" and "Edited N files" draw as live quiet lines under Reduced and Quiet. Detailed opens them.
 *
 * CDXC:SessionChat 2026-11-07 WHY:
 * The 12.5pt type of the lines is the builder's pick from the mockups, the desktop's.
 *
 * CDXC:SessionChat 2026-11-07 SEE-ALSO:
 * packages/gx-chat-core/src/transcript/chat_look.rs (the user decision), apps/desktop/src/app/native_chat/quiet_work.rs (the desktop draws the same lines), packages/gx-chat-core/src/transcript/grouped_work.rs (the Reduced line).
 */

import type { ReactNode } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ProjectedMessage, WorkStat } from '../../rust/document';
import { useLoop } from '../cards/primitives';
import { useTranscriptEnv } from './context';
import { Glyph } from './icons';
import { arr, obj, str } from './json';
import type { TranscriptTheme } from './theme';

/** The space between a quiet line and the agent text that follows it. */
export const QUIET_TEXT_GAP = 2;
/** The lines' type: 12.5pt on a 20pt line. */
export const QUIET_TEXT_SIZE = 12.5;
export const QUIET_LINE_HEIGHT = 20;
/** The space between a line's icons and its text. */
export const QUIET_ICON_GAP = 6;
/** How much of the muted text colour a line shows at rest; pressed, it shows all of it. */
const DIM = 0.7;

/** The colour of a quiet line at rest (desktop `ChatAppearance::quiet_dim`). */
export function quietDim(theme: TranscriptTheme): string {
  return theme.mutedInk(DIM);
}

/** A finished call's check (desktop `ChatAppearance::success`). */
export function successTone(light: boolean): string {
  return light ? '#059669' : '#34d399';
}

/** What a work line's first icon says after the clock. */
export type QuietMark = 'done' | 'running' | 'failed';

/** One piece of a line's text, in its own colour when it has one. */
export type QuietSegment = { text: string; color?: string };

/** The mark for calls that are all answered: the cross when one of `messages`' calls failed, else the check. */
export function finishedMark(messages: readonly ProjectedMessage[]): QuietMark {
  const failed = messages.some((message) => arr(message.tools).some((tool) => obj(tool)?.failed === true));
  return failed ? 'failed' : 'done';
}

/** A work line's text: the label, then each count after " · ", a failure in the error tone. The files count is left out: the line says it with its line counts after them. */
export function quietSegments(label: string, stats: readonly WorkStat[], theme: TranscriptTheme): QuietSegment[] {
  const segments: QuietSegment[] = [{ text: label }];
  for (const stat of stats) {
    const kind = str(stat, 'kind');
    if (kind === 'files') continue;
    const failed = kind === 'failed' || kind === 'recovered';
    segments.push({ text: ' · ' });
    segments.push(failed ? { text: str(stat, 'label'), color: theme.error } : { text: str(stat, 'label') });
  }
  return segments;
}

/** `+N −N` in the file card's hues, after a space, when there is a count. */
export function countSegments(added: number, removed: number, theme: TranscriptTheme): QuietSegment[] {
  if (added <= 0 && removed <= 0) return [];
  return [
    { text: ' ' },
    { text: `+${added}`, color: theme.diff.added },
    { text: ' ' },
    { text: `−${removed}`, color: theme.diff.removed },
  ];
}

/** The last part of each path, for an edit line's names, each once. */
export function fileNames(paths: unknown): string[] {
  const names: string[] = [];
  for (const path of arr(paths)) {
    if (typeof path !== 'string') continue;
    const name = path.split(/[/\\]/).pop() ?? path;
    if (name.length > 0 && !names.includes(name)) names.push(name);
  }
  return names;
}

/** `label` with its first letter in lower case, for a label read mid-line. */
export function lowerFirst(label: string): string {
  return label.length === 0 ? label : label[0]!.toLowerCase() + label.slice(1);
}

/**
 * What a quiet step says: the tool's name (its label when it has none), then its argument, else
 * the subagent's name or the call's description, with what failed after it. The same text Find
 * searches (gx-chat-core `quiet_step_text` in `extras/transcript_search.rs`).
 */
export function quietStepText(tool: unknown): [string, string] {
  const name = str(tool, 'name') || str(tool, 'label');
  const argument = str(tool, 'preview') || str(obj(tool)?.subagent, 'name') || str(tool, 'description');
  const failure = str(tool, 'failure');
  const preview = failure.length === 0 ? argument : argument.length === 0 ? failure : `${argument} · ${failure}`;
  return [name, preview];
}

/** The turning loader of a line or step whose call still runs. */
function Loader({ color }: { color: string }) {
  const turn = useLoop(1000, Easing.linear);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ width: 12, height: 12, transform: [{ rotate }] }}>
      <Glyph name="loader-2" size={12} color={color} />
    </Animated.View>
  );
}

/** A line's or a step's status mark: the green check, the error cross, the loader, or the stopped dashes. */
export function QuietStatusMark({ mark }: { mark: QuietMark | 'stopped' }) {
  const { theme } = useTranscriptEnv();
  switch (mark) {
    case 'failed':
      return <Glyph name="x" size={12} color={theme.error} />;
    case 'running':
      return <Loader color={theme.muted} />;
    case 'stopped':
      return <Glyph name="circle-dashed" size={12} color={theme.muted} />;
    default:
      return <Glyph name="check" size={12} color={successTone(theme.light)} />;
  }
}

/**
 * One quiet line: its icons, its text cut to the column, and the chevron while it is open. The line
 * is as wide as what it says; pressing it lights it to the muted colour, as hovering does on the
 * desktop.
 */
function QuietLine({
  icons,
  segments,
  open,
  expandable,
  onPress,
}: {
  icons: (tone: string) => ReactNode;
  segments: readonly QuietSegment[];
  open: boolean;
  expandable: boolean;
  onPress(): void;
}) {
  const { theme } = useTranscriptEnv();
  const spoken = segments.map((segment) => segment.text).join('');
  return (
    <View style={styles.wrap}>
      <Pressable
        disabled={!expandable}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityState={expandable ? { expanded: open } : undefined}
        style={styles.line}
      >
        {({ pressed }) => {
          const tone = pressed ? theme.muted : quietDim(theme);
          return (
            <>
              {icons(tone)}
              <Text numberOfLines={1} style={[styles.text, { color: tone }]}>
                {segments.map((segment, index) => (
                  <Text key={index} style={segment.color !== undefined ? { color: segment.color } : null}>
                    {segment.text}
                  </Text>
                ))}
              </Text>
              {expandable && open ? <Glyph name="chevron-down" size={12} color={tone} /> : null}
            </>
          );
        }}
      </Pressable>
    </View>
  );
}

/** A work line: a clock, its mark, then "Worked for 59s · 5 tool calls" (desktop `quiet_work_line`). */
export function QuietWorkLine({
  segments,
  mark,
  open,
  expandable,
  onPress,
}: {
  segments: readonly QuietSegment[];
  mark: QuietMark;
  open: boolean;
  expandable: boolean;
  onPress(): void;
}) {
  return (
    <QuietLine
      icons={(tone) => (
        <>
          <Glyph name="clock" size={13} color={tone} />
          <QuietStatusMark mark={mark} />
        </>
      )}
      segments={segments}
      open={open}
      expandable={expandable}
      onPress={onPress}
    />
  );
}

/** An edit line: a pencil, "Edited 2 files", `+14` and `−3` in the file card's hues, then the files' names (desktop `quiet_edit_line`). */
export function QuietEditLine({
  label,
  added,
  removed,
  names,
  open,
  onPress,
}: {
  label: string;
  added: number;
  removed: number;
  names: readonly string[];
  open: boolean;
  onPress(): void;
}) {
  const { theme } = useTranscriptEnv();
  const segments: QuietSegment[] = [{ text: label }, ...countSegments(added, removed, theme)];
  if (names.length > 0) segments.push({ text: ` ${names.join(', ')}` });
  return (
    <QuietLine
      icons={(tone) => <Glyph name="pencil" size={13} color={tone} />}
      segments={segments}
      open={open}
      expandable
      onPress={onPress}
    />
  );
}

/** An opened line's steps: a 1pt rail at a tenth of the foreground, the rows 16pt in from it (desktop `quiet_steps`). */
export function QuietSteps({ children }: { children: ReactNode }) {
  const { theme } = useTranscriptEnv();
  return (
    <View style={styles.stepsOuter}>
      <View style={[styles.steps, { borderLeftColor: theme.ink(0.1) }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', minWidth: 0 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: QUIET_ICON_GAP,
    paddingRight: 4,
    minWidth: 0,
    flexShrink: 1,
  },
  text: { fontSize: QUIET_TEXT_SIZE, lineHeight: QUIET_LINE_HEIGHT, flexShrink: 1, minWidth: 0 },
  stepsOuter: { paddingVertical: 2, minWidth: 0 },
  steps: { marginLeft: 6, paddingLeft: 16, borderLeftWidth: 1, minWidth: 0 },
});
