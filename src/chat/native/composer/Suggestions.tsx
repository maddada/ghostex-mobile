/**
 * The `@` files, `/` (or `$`) skills, `+` sessions and `/` commands popup above the composer
 * (`suggestions/render.rs`). A row's `section` is the heading of a new section that starts at it
 * (the `/` list's skills, custom commands and the agent's built-in commands).
 * Trigger detection, filtering, the rows and their order all come from the core's `suggestions`;
 * this draws them and reports a pick (`suggestionPick`) or a retry (`suggestionRetry`).
 */

import { Fragment } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import type { UserAction } from '../../rust/actions';
import { Glyph } from './icons';
import { arr, isTrue, num, obj, str } from './json';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { AgentMark } from '../cards/agentMark';
import { CoordinatorGlyph } from '../../../components/sessions/icons';
import { sidebarInk } from '../../../components/sessions/rows';
import { SidebarPalette } from '../../../theme/palette';

/** A working session's state in the `+` list: the working amber of the chat's pills. */
const WORKING_COLOR = '#f5a524';

export function Suggestions({ data, dispatch }: { data: unknown; dispatch: (action: UserAction) => void }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const popup = obj(data);
  if (popup === null) return null;
  const rows = arr(popup.rows);
  const files = str(popup, 'kind') === 'file';
  // The `+` list (gx-chat-core `session_mentions.rs`): each row leads with its agent's logo.
  const sessions = str(popup, 'kind') === 'session';
  const selected = num(popup, 'selected') ?? -1;
  const status = str(popup, 'status');
  const heading = str(popup, 'heading');
  return (
    <View style={styles.popup} accessibilityRole="menu" accessibilityLabel={heading}>
      <ScrollView keyboardShouldPersistTaps="always" style={styles.scroll} contentContainerStyle={styles.content}>
        {heading.length > 0 ? <Text style={styles.heading}>{heading.toUpperCase()}</Text> : null}
        {status.length > 0 ? (
          <View style={styles.status}>
            {isTrue(popup, 'loading') ? <ActivityIndicator size="small" color={P.muted} /> : null}
            <Text style={styles.statusText}>{status}</Text>
            {isTrue(popup, 'retry') ? (
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => dispatch({ type: 'suggestionRetry' })}
                style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
              >
                <Text style={styles.retry}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {rows.map((row, index) => (
          <Fragment key={`${index}:${str(row, 'label')}`}>
            {str(row, 'section').length > 0 ? (
              <Text style={styles.heading} accessibilityRole="header">
                {str(row, 'section').toUpperCase()}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="menuitem"
              accessibilityState={{ selected: index === selected }}
              onPress={() => dispatch({ type: 'suggestionPick', index })}
              style={({ pressed }) => [styles.row, index === selected || pressed ? styles.rowSelected : null]}
            >
              {files ? <Glyph name="file" size={16} color={P.muted} strokeWidth={1.6} /> : null}
              {sessions ? (
                isTrue(row, 'coordinator') ? (
                  /* A main coordinator's crown is gold (the core's `mainCoordinator`; CDXC:Coordinators 2026-11-12 in gx-chat-core session_mentions.rs). */
                  <CoordinatorGlyph
                    size={16}
                    color={
                      isTrue(row, 'mainCoordinator')
                        ? sidebarInk(P.light).mainCrown
                        : P.light
                          ? '#000000'
                          : SidebarPalette.ROW_COORDINATOR_CROWN
                    }
                  />
                ) : (
                  <AgentMark icon={str(row, 'agentIcon') || null} size={16} />
                )
              ) : null}
              <Text style={[styles.label, sessions ? styles.sessionLabel : null]} numberOfLines={1}>
                {str(row, 'label')}
              </Text>
              <Text
                style={[styles.detail, sessions && isTrue(row, 'working') ? { color: WORKING_COLOR } : null]}
                numberOfLines={1}
              >
                {str(row, 'detail')}
              </Text>
            </Pressable>
          </Fragment>
        ))}
      </ScrollView>
    </View>
  );
}

const useStyles = themedStyles((P) => ({
  popup: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: P.composerBorder,
    backgroundColor: P.menu,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  scroll: { maxHeight: 264 },
  content: { padding: 6 },
  heading: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    color: P.muted,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.4,
  },
  status: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  statusText: { flex: 1, color: P.muted, fontSize: 14 },
  // React's outline Retry, now the chat's neutral fill (CDXC:AppModal 2026-10-14 on the desktop's `neutral_button_fills`).
  retryButton: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 6,
    justifyContent: 'center',
    backgroundColor: P.neutralFill,
  },
  retryButtonPressed: { backgroundColor: P.neutralFillPressed },
  retry: { color: P.foreground, fontSize: 14, fontWeight: '500' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40, paddingHorizontal: 12, borderRadius: 10 },
  rowSelected: { backgroundColor: P.border },
  label: { color: P.foreground, fontSize: 14, flexShrink: 0, maxWidth: '60%' },
  sessionLabel: { flexShrink: 1, maxWidth: '70%' },
  detail: { flex: 1, color: P.muted, fontSize: 13 },
}));
