/**
 * A work-mode session card's second line of chips (./workChipModel.ts holds what they show): borderless
 * glyph + label pairs under the title, like the desktop's
 * apps/desktop/src/app/native_sidebar/work_chips.rs.
 *
 * CDXC:WorkMode 2026-10-09 DECISION:
 * User: in work mode a session linked to a PR, issue or Linear project gets a second line of borderless chips (PR with state and checks, issue with status); clicking one opens it; sessions with no links stay one line. On the phone a tap opens the link, a long press copies it (the phone has no hover, so a pressed chip underlines instead), and the merged-PR offer's Clean up / Keep chips answer it.
 */

import type { ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { SidebarPalette } from '../../theme/palette';
import { ds } from './rows';
import type { WorkChip, WorkChipGlyph } from './workChipModel';

/** The chip line's height under the 34dp first line; the card is 52dp, leaving 2dp below it. */
export const WORK_CHIP_LINE_HEIGHT = 16;
/** A session card with a chip line (desktop session_list.rs `WORK_SESSION_HEIGHT`). */
export const WORK_SESSION_ROW_HEIGHT = 52;

const GLYPH_SIZE = 12;

/** The desktop's chip glyphs (apps/desktop/assets/titlebar/*.svg), 24-unit Tabler artwork. */
function ChipGlyph({ glyph, color, size }: { glyph: WorkChipGlyph; color: string; size: number }): ReactElement {
  const stroke = { stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const ring = <Path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" {...stroke} />;
  let body: ReactElement;
  switch (glyph) {
    case 'pullRequest':
      body = (
        <>
          <Path d="M4 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" {...stroke} />
          <Path d="M4 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" {...stroke} />
          <Path d="M16 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" {...stroke} />
          <Path d="M6 8l0 8" {...stroke} />
          <Path d="M11 6h5a2 2 0 0 1 2 2v8" {...stroke} />
          <Path d="M14 9l-3 -3l3 -3" {...stroke} />
        </>
      );
      break;
    case 'merged':
      body = (
        <>
          <Path d="M5 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" {...stroke} />
          <Path d="M5 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" {...stroke} />
          <Path d="M15 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" {...stroke} />
          <Path d="M7 8l0 8" {...stroke} />
          <Path d="M7 8a4 4 0 0 0 4 4h4" {...stroke} />
        </>
      );
      break;
    case 'checksPassing':
    case 'issueClosed':
      body = (
        <>
          {ring}
          <Path d="M9 12l2 2l4 -4" {...stroke} />
        </>
      );
      break;
    case 'checksFailing':
    case 'linearCanceled':
      body = (
        <>
          {ring}
          <Path d="M10 10l4 4m0 -4l-4 4" {...stroke} />
        </>
      );
      break;
    case 'checksPending':
      body = <Path d="M12 3a9 9 0 1 0 9 9" {...stroke} />;
      break;
    case 'issueOpen':
      body = (
        <>
          {ring}
          <Path d="M9.5 12a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0" {...stroke} fill={color} />
        </>
      );
      break;
    case 'linearStarted':
      body = (
        <>
          {ring}
          <Path d="M12 7a5 5 0 0 1 0 10z" fill={color} />
        </>
      );
      break;
    case 'linearReview':
      body = (
        <>
          {ring}
          <Path d="M12 12l0 -5a5 5 0 1 1 -5 5z" fill={color} />
        </>
      );
      break;
    case 'linearDone':
      body = (
        <Path
          d="M17 3.34a10 10 0 1 1 -14.995 8.984l-.005 -.324l.005 -.324a10 10 0 0 1 14.995 -8.336zm-1.293 5.953a1 1 0 0 0 -1.32 -.083l-.094 .083l-3.293 3.292l-1.293 -1.292l-.094 -.083a1 1 0 0 0 -1.403 1.403l.083 .094l2 2l.094 .083a1 1 0 0 0 1.226 0l.094 -.083l4 -4l.083 -.094a1 1 0 0 0 -.083 -1.32z"
          fill={color}
        />
      );
      break;
    case 'linearBacklog':
      body = (
        <>
          <Path d="M8.56 3.69a9 9 0 0 0 -2.92 1.95" {...stroke} />
          <Path d="M3.69 8.56a9 9 0 0 0 -.69 3.44" {...stroke} />
          <Path d="M3.69 15.44a9 9 0 0 0 1.95 2.92" {...stroke} />
          <Path d="M8.56 20.31a9 9 0 0 0 3.44 .69" {...stroke} />
          <Path d="M15.44 20.31a9 9 0 0 0 2.92 -1.95" {...stroke} />
          <Path d="M20.31 15.44a9 9 0 0 0 .69 -3.44" {...stroke} />
          <Path d="M20.31 8.56a9 9 0 0 0 -1.95 -2.92" {...stroke} />
          <Path d="M15.44 3.69a9 9 0 0 0 -3.44 -.69" {...stroke} />
        </>
      );
      break;
    case 'linearCircle':
      body = <Circle cx={12} cy={12} r={6} stroke={color} strokeWidth={2.4} />;
      break;
    case 'linearProject':
      body = (
        <>
          <Path d="M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5" {...stroke} />
          <Path d="M12 12l8 -4.5" {...stroke} />
          <Path d="M12 12l0 9" {...stroke} />
          <Path d="M12 12l-8 -4.5" {...stroke} />
        </>
      );
      break;
    case 'cleanUp':
      body = (
        <>
          <Path d="M3 6a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2" {...stroke} />
          <Path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-10" {...stroke} />
          <Path d="M10 12l4 0" {...stroke} />
        </>
      );
      break;
    case 'keep':
      body = <Path d="M18 6l-12 12M6 6l12 12" {...stroke} />;
      break;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {body}
    </Svg>
  );
}

export type WorkChipActions = {
  /** A chip with a link was tapped. */
  openLink: (url: string) => void;
  /** A chip with a link was long-pressed. */
  copyLink: (url: string) => void;
  /** Clean up or Keep was tapped. */
  answerCleanup: (answer: 'cleanUp' | 'keep') => void;
};

export default function WorkChips({
  chips,
  paddingLeft,
  actions,
}: {
  chips: readonly WorkChip[];
  /** Lines the chips up under the title. */
  paddingLeft: number;
  actions: WorkChipActions;
}) {
  return (
    <View style={[styles.line, { paddingLeft }]}>
      {chips.map((chip) => {
        const answer = chip.cleanupAnswer;
        const url = chip.url;
        const pressable = answer !== undefined || url.length > 0;
        return (
          <Pressable
            key={chip.key}
            accessibilityRole={answer !== undefined ? 'button' : 'link'}
            accessibilityLabel={chip.description}
            accessibilityHint={url.length > 0 ? 'Touch and hold to copy the link' : undefined}
            disabled={!pressable}
            hitSlop={{ top: ds(4), bottom: ds(4), left: ds(4), right: ds(4) }}
            onPress={() => {
              if (answer !== undefined) actions.answerCleanup(answer);
              else if (url.length > 0) actions.openLink(url);
            }}
            onLongPress={url.length > 0 ? () => actions.copyLink(url) : undefined}
            style={styles.chip}
          >
            {({ pressed }) => (
              <>
                <ChipGlyph glyph={chip.glyph} color={chip.glyphColor} size={ds(GLYPH_SIZE)} />
                <Text numberOfLines={1} style={[styles.label, pressed ? styles.labelPressed : null]}>
                  {chip.label}
                </Text>
                {chip.trailing !== undefined ? (
                  <ChipGlyph glyph={chip.trailing.glyph} color={chip.trailing.color} size={ds(GLYPH_SIZE)} />
                ) : null}
              </>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    height: ds(WORK_CHIP_LINE_HEIGHT),
    flexDirection: 'row',
    alignItems: 'center',
    gap: ds(10),
    paddingRight: ds(6),
    overflow: 'hidden',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: ds(3),
  },
  label: {
    color: SidebarPalette.MUTED,
    fontSize: ds(11.5),
    lineHeight: ds(WORK_CHIP_LINE_HEIGHT),
  },
  labelPressed: {
    color: SidebarPalette.FOREGROUND,
    textDecorationLine: 'underline',
  },
});
