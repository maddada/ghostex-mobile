/**
 * The phone's Link to picker: a searchable list of what a work-mode session can link to (open PRs,
 * Linear issues, Linear projects or GitHub issues), opened from the session menu's Link to
 * submenu. Linear issues are a list, so that kind ticks several rows and saves them together; the
 * other kinds link the row you tap.
 *
 * The suggestions are gxserver's (server/src/work_mode/candidates.rs), the same ones the desktop's
 * picker shows, read through `ghostex link-session --candidates <kind> --query <text>`; the pick
 * is saved by the caller through `ghostex link-session`.
 *
 * CDXC:WorkMode 2026-10-09 DECISION:
 * User: Link to → Pull request…, Linear issue…, Linear project…, GitHub issue… opens a picker whose suggestions come from the session's repo first, then everything else as you type; Linear issues are a list, the other kinds one each. The phone has the same picker as a simple searchable list.
 *
 * SEE-ALSO: apps/desktop/src/app/window/work_link_picker_modal.rs (the desktop's picker).
 */

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { WorkLinkKind } from '../../commands/ghostexCli';
import { GhostexPalette, GhostexStrokeWidth } from '../../theme/palette';

export type WorkLinkCandidate = {
  /** What `ghostex link-session` takes for the kind: a PR or issue number, a Linear ID or a project name. */
  value: string;
  label: string;
  title: string;
  detail: string;
  /** The session is linked to this one now. */
  linked: boolean;
};

export type WorkLinkCandidates = {
  multiSelect: boolean;
  /** What the session links to now (hand-set or automatic), as candidate values. */
  linked: string[];
  candidates: WorkLinkCandidate[];
  /** Why there are no suggestions (no `gh`, no Linear key), or ''. */
  notice: string;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** `ghostex link-session --candidates … --json`, as the picker reads it. */
export function parseWorkLinkCandidates(json: unknown): WorkLinkCandidates {
  const root = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {};
  const candidates: WorkLinkCandidate[] = [];
  if (Array.isArray(root.candidates)) {
    for (const entry of root.candidates) {
      if (typeof entry !== 'object' || entry === null) continue;
      const candidate = entry as Record<string, unknown>;
      const value = text(candidate.value);
      if (value.length === 0) continue;
      candidates.push({
        value,
        label: text(candidate.label) || value,
        title: text(candidate.title),
        detail: text(candidate.detail),
        linked: candidate.linked === true,
      });
    }
  }
  return {
    multiSelect: root.multiSelect === true,
    linked: Array.isArray(root.linked) ? root.linked.map(text).filter((value) => value.length > 0) : [],
    candidates,
    notice: text(root.notice),
  };
}

const KIND_TITLES: Record<WorkLinkKind, string> = {
  pullRequest: 'Link a pull request',
  linearIssue: 'Link Linear issues',
  linearProject: 'Link a Linear project',
  githubIssue: 'Link a GitHub issue',
  githubProject: 'Link a GitHub project',
};

const KIND_PLACEHOLDERS: Record<WorkLinkKind, string> = {
  pullRequest: 'Search pull requests',
  linearIssue: 'Search Linear issues',
  linearProject: 'Search Linear projects',
  githubIssue: 'Search GitHub issues',
  githubProject: 'Search GitHub projects',
};

/** Typing waits this long for a pause before asking the computer again. */
const SEARCH_DELAY_MS = 350;

export type WorkLinkPickerProps = {
  kind: WorkLinkKind;
  sessionTitle: string;
  load: (query: string) => Promise<WorkLinkCandidates>;
  /** The values to link: one for a single-select kind, the ticked list for Linear issues. */
  onPick: (values: string[]) => void;
  onCancel: () => void;
};

export default function WorkLinkPicker({ kind, sessionTitle, load, onPick, onCancel }: WorkLinkPickerProps) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<WorkLinkCandidates | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Ticked values of a multi-select kind; null until the first answer says what is linked now.
  const [selected, setSelected] = useState<string[] | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () => {
        setLoading(true);
        loadRef
          .current(query)
          .then((answer) => {
            if (cancelled) return;
            setResult(answer);
            setError(null);
            setSelected((current) => current ?? answer.linked);
          })
          .catch((reason: unknown) => {
            if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      },
      query.length === 0 ? 0 : SEARCH_DELAY_MS,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const multiSelect = kind === 'linearIssue' || result?.multiSelect === true;
  const ticked = selected ?? [];

  const toggle = (value: string): void => {
    setSelected((current) => {
      const list = current ?? [];
      return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
    });
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={onCancel}>
            <Text style={styles.headerAction}>Cancel</Text>
          </Pressable>
          <View style={styles.headerTitleBox}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {KIND_TITLES[kind]}
            </Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {sessionTitle}
            </Text>
          </View>
          {multiSelect ? (
            <Pressable
              accessibilityRole="button"
              disabled={selected === null}
              hitSlop={8}
              onPress={() => onPick(ticked)}
            >
              <Text style={[styles.headerAction, selected === null ? styles.headerActionDisabled : null]}>
                {ticked.length > 0 ? `Save (${ticked.length})` : 'Save'}
              </Text>
            </Pressable>
          ) : (
            <View style={styles.headerSpacer} />
          )}
        </View>
        <TextInput
          accessibilityLabel="Search"
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          placeholder={KIND_PLACEHOLDERS[kind]}
          placeholderTextColor={GhostexPalette.MUTED}
          returnKeyType="search"
          style={styles.search}
          value={query}
          onChangeText={setQuery}
        />
        {loading ? <ActivityIndicator style={styles.spinner} color={GhostexPalette.MUTED} /> : null}
        {error !== null ? <Text style={styles.error}>{error}</Text> : null}
        {result !== null && result.notice.length > 0 ? <Text style={styles.notice}>{result.notice}</Text> : null}
        <FlatList
          data={result?.candidates ?? []}
          keyExtractor={(item) => item.value}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            !loading && error === null && result !== null && result.notice.length === 0 ? (
              <Text style={styles.empty}>Nothing found{query.length > 0 ? ` for "${query}"` : ''}.</Text>
            ) : null
          }
          renderItem={({ item }) => {
            const isTicked = multiSelect && ticked.includes(item.value);
            return (
              <Pressable
                accessibilityRole={multiSelect ? 'checkbox' : 'button'}
                accessibilityState={multiSelect ? { checked: isTicked } : undefined}
                style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
                onPress={() => (multiSelect ? toggle(item.value) : onPick([item.value]))}
              >
                {multiSelect ? (
                  <View style={[styles.box, isTicked ? styles.boxTicked : null]}>
                    {isTicked ? <Text style={styles.boxMark}>✓</Text> : null}
                  </View>
                ) : null}
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={2}>
                    <Text style={styles.rowLabel}>{item.label}</Text>
                    {item.title.length > 0 ? `  ${item.title}` : ''}
                  </Text>
                  {item.detail.length > 0 ? (
                    <Text style={styles.rowDetail} numberOfLines={1}>
                      {item.detail}
                    </Text>
                  ) : null}
                </View>
                {!multiSelect && item.linked ? <Text style={styles.linkedTag}>Linked</Text> : null}
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: GhostexPalette.BACKGROUND,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  headerTitleBox: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 16,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    marginTop: 2,
  },
  headerAction: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 15,
  },
  headerActionDisabled: {
    opacity: 0.4,
  },
  headerSpacer: {
    width: 48,
  },
  search: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    backgroundColor: 'rgba(255,255,255,0.06)',
    color: GhostexPalette.FOREGROUND,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
  },
  spinner: {
    marginVertical: 8,
  },
  error: {
    color: '#FF7B72',
    fontSize: 12,
    lineHeight: 17,
    marginHorizontal: 16,
    marginVertical: 8,
  },
  notice: {
    color: GhostexPalette.MUTED,
    fontSize: 13,
    lineHeight: 18,
    marginHorizontal: 16,
    marginVertical: 8,
  },
  empty: {
    color: GhostexPalette.MUTED,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  rowPressed: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  rowBody: {
    flex: 1,
  },
  rowTitle: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 14,
    lineHeight: 19,
  },
  rowLabel: {
    fontWeight: '600',
  },
  rowDetail: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    marginTop: 2,
  },
  linkedTag: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
  },
  box: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxTicked: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  boxMark: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 13,
    lineHeight: 16,
  },
});
