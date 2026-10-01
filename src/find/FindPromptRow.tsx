/**
 * One Find result: the matched prompt with its matches highlighted, then the
 * agent, how long ago the session was active, and its title and project, the
 * terminal picker's two-line shape. The star at the end stars the prompt in
 * place; tapping the row opens the prompt screen.
 */

import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { StarGlyph } from '../components/sessions/icons';
import { FindPromptsCopy } from '../copy';
import { promptLineSegments } from './findFormat';
import { FIND_STAR_COLOR, type FindStyles } from './findStyles';
import type { FindPromptRow as FindPromptRowData } from './promptSearch';

export type FindPromptRowProps = {
  row: FindPromptRowData;
  timeLabel: string;
  styles: FindStyles;
  /** Unstarred star outline. */
  dimColor: string;
  onOpen: (row: FindPromptRowData) => void;
  onToggleFavorite: (row: FindPromptRowData) => void;
};

function FindPromptRow({ row, timeLabel, styles, dimColor, onOpen, onToggleFavorite }: FindPromptRowProps) {
  const segments = promptLineSegments(row.text, row.highlights);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.agent}: ${row.text.slice(0, 120)}`}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
      onPress={() => onOpen(row)}
    >
      <View style={styles.rowBody}>
        <Text style={styles.rowPrompt} numberOfLines={2}>
          {segments.map((segment, position) =>
            segment.highlighted ? (
              <Text key={position} style={styles.match}>
                {segment.text}
              </Text>
            ) : (
              segment.text
            ),
          )}
        </Text>
        <View style={styles.rowMeta}>
          <Text style={[styles.rowAgent, { color: row.agentColor || dimColor }]}>{row.agent}</Text>
          <Text style={styles.rowDetail} numberOfLines={1}>
            {timeLabel}
            {'  '}
            {row.title}
            {row.projectName.length > 0 ? ` • ${row.projectName}` : ''}
          </Text>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={row.favorite ? FindPromptsCopy.unfavorite : FindPromptsCopy.favorite}
        accessibilityState={{ selected: row.favorite }}
        hitSlop={4}
        style={styles.starButton}
        onPress={() => onToggleFavorite(row)}
      >
        <StarGlyph size={18} color={row.favorite ? FIND_STAR_COLOR : dimColor} filled={row.favorite} />
      </Pressable>
    </Pressable>
  );
}

export default memo(FindPromptRow);
