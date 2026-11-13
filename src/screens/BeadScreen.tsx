/**
 * One bead full screen, opened from the Beads screen (back returns to the list where it was): its
 * id, type and status, title, Close / Reopen / Defer / Bring back / Claim, a decision's Answer and
 * Dismiss, Priority, Labels, Links, its Epic and progress, who claimed it, the description, and the
 * comments with Add a comment, as the desktop Beads view's details show them
 * (`apps/desktop/src/app/native_beads/details.rs`, `links.rs`).
 *
 * Links are the bead's external link and spec (bd's `external_ref`, `spec_id`): a web link opens in
 * the browser, a spec path in the file viewer. They change only on a computer that advertises
 * `links`; elsewhere they show read-only with what to do.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BEADS_LINKS_CAPABILITY,
  detailsFrom,
  isWebLink,
  linkLabel,
  localDateAfter,
  parseBdTime,
  relativeAgo,
  type BeadDetails,
} from '../beads/model';
import { beadPage, type BeadPage } from '../beads/tree';
import { NoticeCard, PriorityTag, StatusMark } from '../beads/parts';
import {
  beadsKey,
  bindingKey as keyOfBinding,
  currentBinding,
  dismissBeadsNotice,
  runBeads,
  useBeadsEntry,
  useBeadsPolling,
  type BeadsBinding,
} from '../beads/store';
import { onPairingChanged } from '../machines/pairingEpoch';
import { Glyph } from '../chat/native/transcript/icons';
import { MONO_FONT, themedStyles, useTranscriptTheme } from '../chat/native/transcript/theme';
import ActionSheet, { type ActionSheetItem } from '../components/common/ActionSheet';
import NoticeToast, { type Notice } from '../components/common/NoticeToast';
import PromptDialog from '../components/common/PromptDialog';
import { BeadsCopy } from '../copy';
import { openComputerFile } from '../docs/openComputerFile';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Bead'>;

type LinkKind = 'externalRef' | 'specId';

type Sheet = { title: string; subtitle?: string; items: ActionSheetItem[] } | null;
type Prompt = {
  title: string;
  body?: string;
  placeholder: string;
  initial?: string;
  multiline?: boolean;
  confirm: string;
  submit: (value: string) => void;
} | null;

export default function BeadScreen({ navigation, route }: Props) {
  const { machineId, projectId, projectPath, beadId } = route.params;
  const project = useMemo(() => ({ projectId, projectPath }), [projectId, projectPath]);
  const entry = useBeadsEntry(beadsKey(machineId, projectId));
  const theme = useTranscriptTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  useBeadsPolling(machineId, project);

  const rows = entry.snapshot?.beads ?? null;
  const row = useMemo(() => (rows ?? []).find((candidate) => candidate.id === beadId) ?? null, [rows, beadId]);
  const canEditLinks = entry.snapshot?.capabilities.includes(BEADS_LINKS_CAPABILITY) === true;

  // What every action on this screen is bound to: the workspace of the snapshot on screen and the
  // pairing epoch that snapshot was read under (none for a snapshot from an older pairing).
  const [pairingTick, setPairingTick] = useState(0);
  useEffect(
    () =>
      onPairingChanged((changed) => {
        if (changed === machineId) setPairingTick((tick) => tick + 1);
      }),
    [machineId],
  );
  const binding = useMemo<BeadsBinding | null>(
    () => currentBinding(machineId, projectId),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed when the snapshot or the pairing changes
    [entry.snapshot, entry.epoch, machineId, projectId, pairingTick],
  );
  const bindingKey = keyOfBinding(binding);
  const liveBinding = useRef(bindingKey);
  liveBinding.current = bindingKey;

  // The bead's row words, its epic and progress, from the desktop's rules in the phone's core.
  const [page, setPage] = useState<BeadPage | null>(null);
  /** The core could not lay out this bead (an older core without the call, a refused answer). */
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageAttempt, setPageAttempt] = useState(0);
  const readiness = entry.snapshot?.readiness ?? 'ok';
  useEffect(() => {
    if (rows === null) return undefined;
    let current = true;
    beadPage(rows, readiness, beadId)
      .then((next) => {
        if (!current) return;
        setPage(next);
        setPageError(null);
      })
      .catch((failure: unknown) => {
        if (current) setPageError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => {
      current = false;
    };
  }, [rows, readiness, beadId, pageAttempt]);
  const epic = page?.epic ?? null;

  const [details, setDetails] = useState<BeadDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  /** The binding the comment being typed was started under; it is sent only while that still holds. */
  const commentBinding = useRef<BeadsBinding | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [toast, setToast] = useState<Notice | null>(null);
  const toastId = useRef(0);
  const notify = useCallback((message: string, error: boolean, title?: string) => {
    toastId.current += 1;
    setToast({ id: toastId.current, message, error, title });
  }, []);

  const detailsRequest = useRef(0);
  // Another workspace, a re-paired computer or no read at all: nothing opened before applies any
  // more, and every details read already sent is disowned at once.
  const shownBinding = useRef(bindingKey);
  useEffect(() => {
    if (shownBinding.current === bindingKey) return;
    shownBinding.current = bindingKey;
    detailsRequest.current += 1;
    setSheet(null);
    setPrompt(null);
    setDetails(null);
    setDetailsError(null);
    setDetailsLoading(true);
  }, [bindingKey]);

  const loadDetails = useCallback(async () => {
    detailsRequest.current += 1;
    const request = detailsRequest.current;
    const sentFor = keyOfBinding(binding);
    const reply = await runBeads(machineId, project, { action: 'show', issueId: beadId }, BeadsCopy.failed.show, binding);
    // An answer for an older request, or for a binding the screen no longer shows, is dropped.
    if (request !== detailsRequest.current || sentFor !== liveBinding.current) return;
    if (reply === null) {
      setDetailsLoading(false);
      return;
    }
    const shown = reply.ok ? detailsFrom(reply.result) : null;
    setDetailsLoading(false);
    if (shown === null) {
      setDetailsError(reply.output.length > 0 ? reply.output.split('\n').slice(-1)[0] : BeadsCopy.failed.show);
      return;
    }
    setDetailsError(null);
    setDetails(shown);
  }, [beadId, binding, machineId, project]);

  // Read the bead's description, links and comments again whenever bd says it changed.
  const updatedAt = row?.updatedAt ?? '';
  const commentCount = row?.commentCount ?? 0;
  useEffect(() => {
    if (binding === null) return;
    void loadDetails();
  }, [binding, loadDetails, updatedAt, commentCount]);

  /** One write for this bead, bound to `opened`: the binding when its sheet, prompt or draft opened. */
  const act = useCallback(
    async (opened: BeadsBinding | null, params: Record<string, unknown>, failure: string, after?: () => void) => {
      const reply = await runBeads(machineId, project, { issueId: beadId, ...params }, failure, opened);
      if (reply?.ok === true) after?.();
    },
    [beadId, machineId, project],
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      title: epic !== null ? epic.title : '',
      headerStyle: { backgroundColor: theme.background },
      headerTintColor: theme.foreground,
      contentStyle: { backgroundColor: theme.background },
    });
  }, [epic, navigation, theme]);

  if (row !== null && page === null && pageError !== null) {
    return (
      <View style={styles.screen}>
        <View style={styles.cardWrap}>
          <NoticeCard
            notice={{ title: BeadsCopy.pageFailedTitle, message: BeadsCopy.coreFailed, details: pageError }}
            action={{ label: BeadsCopy.retry, onPress: () => setPageAttempt((attempt) => attempt + 1) }}
          />
          <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.backLink}>
            <Text style={styles.link}>{BeadsCopy.backToList}</Text>
          </Pressable>
        </View>
      </View>
    );
  }
  if (row === null || page === null) {
    return (
      <View style={styles.screen}>
        <View style={styles.centered}>
          {rows === null || row !== null ? <ActivityIndicator color={theme.muted} /> : <Text style={styles.muted}>{BeadsCopy.beadGone}</Text>}
        </View>
      </View>
    );
  }

  const closed = page.row.closed;
  const deferred = row.status === 'deferred';
  const claimable = page.row.claimable;
  /** The binding a sheet or prompt opens with; its rows write only there. */
  const opened = binding;

  const openDefer = () =>
    setSheet({
      title: BeadsCopy.defer,
      items: [
        { key: 'tomorrow', label: BeadsCopy.deferTomorrow, onPress: () => deferUntil(localDateAfter(1)) },
        { key: 'week', label: BeadsCopy.deferNextWeek, onPress: () => deferUntil(localDateAfter(7)) },
        { key: 'ice', label: BeadsCopy.deferOnIce, detail: BeadsCopy.deferOnIceDetail, onPress: () => deferUntil(null) },
      ],
    });
  const deferUntil = (until: string | null) => {
    setSheet(null);
    void act(opened, { action: 'defer', ...(until !== null ? { until } : {}) }, BeadsCopy.failed.defer);
  };

  const openPriority = () =>
    setSheet({
      title: BeadsCopy.priority,
      items: [0, 1, 2, 3, 4].map((priority) => ({
        key: String(priority),
        label: `P${priority}${row.priority === priority ? '  ✓' : ''}`,
        onPress: () => {
          setSheet(null);
          if (row.priority !== priority) void act(opened, { action: 'updatePriority', priority: String(priority) }, BeadsCopy.failed.priority);
        },
      })),
    });

  const addLabel = () =>
    setPrompt({
      title: BeadsCopy.addLabel,
      placeholder: BeadsCopy.addLabelPlaceholder,
      confirm: BeadsCopy.addLabel,
      submit: (value) => {
        const label = value.trim();
        if (label.length > 0) void act(opened, { action: 'addLabel', label }, BeadsCopy.failed.label);
      },
    });

  const labelMenu = (label: string) =>
    setSheet({
      title: label,
      items: [
        {
          key: 'remove',
          label: BeadsCopy.removeLabel(label),
          destructive: true,
          onPress: () => {
            setSheet(null);
            void act(opened, { action: 'removeLabel', label }, BeadsCopy.failed.label);
          },
        },
      ],
    });

  const openLink = (kind: LinkKind, link: string) => {
    if (isWebLink(link)) {
      void Linking.openURL(link).catch(() => notify(`Couldn’t open ${link}`, true));
      return;
    }
    if (kind === 'externalRef') {
      void Clipboard.setStringAsync(link).then(() => notify(link, false, 'Copied'));
      return;
    }
    const path = link.startsWith('/') || projectPath.length === 0 ? link : `${projectPath.replace(/\/$/u, '')}/${link}`;
    openComputerFile(navigation, machineId, path, { projectId, notify });
  };

  const setLink = (kind: LinkKind, value: string) =>
    void act(opened, { action: 'update', [kind]: value.trim() }, BeadsCopy.failed.link, () => void loadDetails());

  const editLink = (kind: LinkKind, current: string) =>
    setPrompt({
      title: kind === 'externalRef' ? BeadsCopy.externalLink : BeadsCopy.specLink,
      placeholder: BeadsCopy.linkPlaceholder,
      initial: current,
      confirm: BeadsCopy.save,
      submit: (value) => {
        if (value.trim() !== current) setLink(kind, value);
      },
    });

  const linkMenu = (kind: LinkKind, link: string) =>
    setSheet({
      title: kind === 'externalRef' ? BeadsCopy.externalLink : BeadsCopy.specLink,
      subtitle: link,
      items: [
        { key: 'change', label: BeadsCopy.changeLink, onPress: () => (setSheet(null), editLink(kind, link)) },
        { key: 'remove', label: BeadsCopy.clearLink, destructive: true, onPress: () => (setSheet(null), setLink(kind, '')) },
      ],
    });

  const links: { kind: LinkKind; link: string }[] = [];
  if (details !== null && details.externalRef.length > 0) links.push({ kind: 'externalRef', link: details.externalRef });
  if (details !== null && details.specId.length > 0) links.push({ kind: 'specId', link: details.specId });
  const missingKinds: LinkKind[] = (['externalRef', 'specId'] as LinkKind[]).filter((kind) => !links.some((link) => link.kind === kind));
  const addLink = () =>
    missingKinds.length === 1
      ? editLink(missingKinds[0], '')
      : setSheet({
          title: BeadsCopy.addLink,
          items: missingKinds.map((kind) => ({
            key: kind,
            label: kind === 'externalRef' ? BeadsCopy.externalLink : BeadsCopy.specLink,
            onPress: () => (setSheet(null), editLink(kind, '')),
          })),
        });

  const answerDecision = () =>
    setPrompt({
      title: BeadsCopy.respond,
      placeholder: BeadsCopy.respondPlaceholder,
      multiline: true,
      confirm: BeadsCopy.respond,
      submit: (value) => {
        if (value.trim().length > 0) void act(opened, { action: 'humanRespond', response: value.trim() }, BeadsCopy.failed.respond);
      },
    });

  const sendComment = () => {
    const text = comment.trim();
    if (text.length === 0) return;
    void act(commentBinding.current, { action: 'comment', comment: text }, BeadsCopy.failed.comment, () => {
      setComment('');
      commentBinding.current = null;
      void loadDetails();
    });
  };

  const assignee = details?.assignee || row.assignee;
  const summary = page.summary;
  const epicProgress = epic?.summary ?? null;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {entry.notice !== null ? (
          <View style={styles.noticeWrap}>
            <NoticeCard notice={entry.notice} onDismiss={() => dismissBeadsNotice(machineId, projectId)} />
          </View>
        ) : null}
        <View style={styles.idLine}>
          <Text style={styles.id} selectable>
            {row.id}
          </Text>
          <Text style={styles.muted}>· {page.row.meta[0] ?? ''}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={BeadsCopy.copyId}
            hitSlop={8}
            onPress={() => void Clipboard.setStringAsync(row.id).then(() => notify(BeadsCopy.idCopied, false))}
            style={styles.iconButton}
          >
            <Glyph name="copy" size={15} color={theme.muted} />
          </Pressable>
          <View style={styles.spacer} />
          <View style={styles.statusChip}>
            <StatusMark glyph={page.row.glyph} size={12} />
            <Text style={styles.statusText}>{page.status}</Text>
          </View>
        </View>
        <Text style={styles.title} selectable>
          {row.title}
        </Text>

        <View style={styles.actions}>
          {closed ? (
            <ActionButton label={BeadsCopy.reopen} onPress={() => void act(opened, { action: 'reopen' }, BeadsCopy.failed.reopen)} primary />
          ) : (
            <ActionButton label={BeadsCopy.close} icon="check" onPress={() => void act(opened, { action: 'close' }, BeadsCopy.failed.close)} primary />
          )}
          {!closed && (deferred ? (
            <ActionButton label={BeadsCopy.bringBack} onPress={() => void act(opened, { action: 'undefer' }, BeadsCopy.failed.undefer)} />
          ) : (
            <ActionButton label={BeadsCopy.defer} icon="clock" onPress={openDefer} />
          ))}
          {claimable ? <ActionButton label={BeadsCopy.claim} onPress={() => void act(opened, { action: 'claim' }, BeadsCopy.failed.claim)} /> : null}
        </View>

        {row.needsDecision && !closed ? (
          <View style={styles.decision}>
            <Text style={styles.decisionTitle}>{BeadsCopy.decision}</Text>
            <View style={styles.actions}>
              <ActionButton label={BeadsCopy.respond} onPress={answerDecision} primary />
              <ActionButton
                label={BeadsCopy.dismissDecision}
                onPress={() => void act(opened, { action: 'humanDismiss' }, BeadsCopy.failed.dismiss)}
              />
            </View>
          </View>
        ) : null}

        <View style={styles.rule} />

        <Field label={BeadsCopy.priority}>
          <Pressable accessibilityRole="button" onPress={openPriority} style={styles.inlineButton} hitSlop={6}>
            <PriorityTag priority={row.priority !== null ? `P${row.priority}` : '—'} />
            <Glyph name="chevron-down" size={13} color={theme.muted} />
          </Pressable>
        </Field>

        <Field label={BeadsCopy.labels}>
          <View style={styles.chips}>
            {row.labels
              .filter((label) => label !== 'human')
              .map((label) => (
                <Pressable key={label} accessibilityRole="button" onPress={() => labelMenu(label)} style={styles.chip}>
                  <Text style={styles.chipText}>{label}</Text>
                </Pressable>
              ))}
            <Pressable accessibilityRole="button" onPress={addLabel} style={[styles.chip, styles.chipAdd]}>
              <Text style={styles.chipText}>+ {BeadsCopy.addLabel}</Text>
            </Pressable>
          </View>
        </Field>

        {links.length > 0 || canEditLinks ? (
          <Field label={BeadsCopy.links}>
            <View style={styles.chips}>
              {links.map(({ kind, link }) => (
                <Pressable
                  key={kind}
                  accessibilityRole="link"
                  accessibilityHint={kind === 'externalRef' ? BeadsCopy.externalLink : BeadsCopy.specLink}
                  onPress={() => openLink(kind, link)}
                  onLongPress={canEditLinks ? () => linkMenu(kind, link) : undefined}
                  style={styles.chip}
                >
                  <Glyph name={kind === 'externalRef' ? 'link' : 'file'} size={12} color={theme.muted} />
                  <Text style={styles.chipText} numberOfLines={1}>
                    {linkLabel(link)}
                  </Text>
                  {canEditLinks ? (
                    <Pressable hitSlop={8} accessibilityLabel={BeadsCopy.changeLink} onPress={() => linkMenu(kind, link)}>
                      <Glyph name="chevron-down" size={12} color={theme.muted} />
                    </Pressable>
                  ) : null}
                </Pressable>
              ))}
              {canEditLinks && missingKinds.length > 0 && details !== null ? (
                <Pressable accessibilityRole="button" onPress={addLink} style={[styles.chip, styles.chipAdd]}>
                  <Text style={styles.chipText}>+ {BeadsCopy.addLink}</Text>
                </Pressable>
              ) : null}
            </View>
            {!canEditLinks ? <Text style={styles.fieldNote}>{BeadsCopy.linksReadOnly}</Text> : null}
          </Field>
        ) : null}

        {epic !== null && epicProgress !== null ? (
          <Field label={BeadsCopy.epic}>
            <Pressable
              accessibilityRole="link"
              onPress={() => navigation.push('Bead', { machineId, projectId, projectPath, beadId: epic.id })}
              style={styles.epicLink}
            >
              <Text style={styles.link} numberOfLines={1}>
                {epic.title}
              </Text>
              <Text style={styles.muted}>{`${epicProgress.done}/${epicProgress.total} done`}</Text>
            </Pressable>
          </Field>
        ) : null}
        {summary !== null ? (
          <Field label={BeadsCopy.progress}>
            <Text style={styles.value}>{summary.text}</Text>
          </Field>
        ) : null}

        <Field label={BeadsCopy.claimedBy}>
          <Text style={styles.value}>{assignee !== null && assignee !== undefined && assignee.length > 0 ? assignee : BeadsCopy.nobody}</Text>
        </Field>

        <Text style={styles.heading}>{BeadsCopy.description.toUpperCase()}</Text>
        {detailsLoading && details === null ? (
          <ActivityIndicator color={theme.muted} style={styles.spinner} />
        ) : detailsError !== null && details === null ? (
          <Text style={styles.mutedLeft}>{detailsError}</Text>
        ) : (
          <Text style={details?.description ? styles.body : styles.mutedLeft} selectable>
            {details?.description || BeadsCopy.noDescription}
          </Text>
        )}

        <Text style={styles.heading}>{BeadsCopy.comments(details?.comments.length ?? row.commentCount).toUpperCase()}</Text>
        {(details?.comments ?? []).map((entryComment, index) => {
          const when = parseBdTime(entryComment.createdAt);
          return (
            <View key={index} style={styles.comment}>
              <Text style={styles.commentMeta}>
                {[entryComment.author, when !== null ? relativeAgo(when) : ''].filter((part) => part.length > 0).join(' · ')}
              </Text>
              <Text style={styles.body} selectable>
                {entryComment.text}
              </Text>
            </View>
          );
        })}
        <TextInput
          value={comment}
          onChangeText={(text) => {
            if (comment.trim().length === 0 || commentBinding.current === null) commentBinding.current = binding;
            setComment(text);
          }}
          placeholder={BeadsCopy.addComment}
          placeholderTextColor={theme.placeholder}
          multiline
          style={styles.commentInput}
        />
        <View style={styles.commentActions}>
          <ActionButton label={BeadsCopy.comment} onPress={sendComment} disabled={comment.trim().length === 0} />
        </View>
      </ScrollView>
      <ActionSheet
        visible={sheet !== null}
        title={sheet?.title ?? ''}
        subtitle={sheet?.subtitle}
        items={sheet?.items ?? []}
        onClose={() => setSheet(null)}
      />
      {prompt !== null ? (
        <PromptDialog
          visible
          title={prompt.title}
          body={prompt.body}
          placeholder={prompt.placeholder}
          initialValue={prompt.initial}
          multiline={prompt.multiline}
          confirmLabel={prompt.confirm}
          onSubmit={(value) => {
            const submit = prompt.submit;
            setPrompt(null);
            submit(value);
          }}
          onCancel={() => setPrompt(null)}
        />
      ) : null}
      <NoticeToast notice={toast} bottom={insets.bottom + 24} />
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldValue}>{children}</View>
    </View>
  );
}

function ActionButton({
  label,
  icon,
  onPress,
  primary = false,
  disabled = false,
}: {
  label: string;
  icon?: 'check' | 'clock';
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  const styles = useStyles();
  const theme = useTranscriptTheme();
  const ink = primary ? theme.send.ink : theme.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && { backgroundColor: theme.send.fill },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {icon !== undefined ? <Glyph name={icon} size={14} color={ink} /> : null}
      <Text style={[styles.buttonText, { color: ink }]}>{label}</Text>
    </Pressable>
  );
}

const useStyles = themedStyles((t) => ({
  screen: { flex: 1, backgroundColor: t.background },
  content: { paddingHorizontal: 16, paddingTop: 12 },
  noticeWrap: { marginHorizontal: -12 },
  centered: { alignItems: 'center', gap: 10, paddingHorizontal: 28, paddingTop: 56 },
  cardWrap: { paddingTop: 16, gap: 8 },
  backLink: { alignSelf: 'center', paddingVertical: 8 },
  idLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  id: { color: t.foreground, fontFamily: MONO_FONT, fontSize: 13 },
  iconButton: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  spacer: { flex: 1 },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: t.controlBorder,
  },
  statusText: { color: t.foreground, fontSize: 12.5, fontWeight: '500' },
  title: { color: t.foreground, fontSize: 20, fontWeight: '700', marginTop: 10, lineHeight: 26 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 9,
    backgroundColor: t.neutralFill,
  },
  buttonText: { fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
  decision: {
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.cardBackground,
  },
  decisionTitle: { color: t.foreground, fontSize: 14, fontWeight: '600' },
  rule: { height: 1, backgroundColor: t.border, marginVertical: 16 },
  field: { flexDirection: 'row', alignItems: 'flex-start', minHeight: 40, paddingVertical: 6 },
  fieldLabel: { width: 96, color: t.muted, fontSize: 13.5, paddingTop: 5 },
  fieldValue: { flex: 1, minWidth: 0, justifyContent: 'center', minHeight: 28 },
  fieldNote: { color: t.muted, fontSize: 12, marginTop: 6 },
  value: { color: t.foreground, fontSize: 14 },
  inlineButton: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: '100%',
    height: 28,
    paddingHorizontal: 9,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: t.controlBorder,
  },
  chipAdd: { borderStyle: 'dashed' },
  chipText: { color: t.foreground, fontSize: 13, flexShrink: 1 },
  epicLink: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  link: { color: t.foreground, fontSize: 14, textDecorationLine: 'underline', flexShrink: 1 },
  heading: { color: t.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0.4, marginTop: 20, marginBottom: 8 },
  body: { color: t.prose, fontSize: 14, lineHeight: 21 },
  muted: { color: t.muted, fontSize: 13 },
  mutedLeft: { color: t.muted, fontSize: 14 },
  spinner: { alignSelf: 'flex-start' },
  comment: { gap: 3, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.border },
  commentMeta: { color: t.muted, fontSize: 12 },
  commentInput: {
    marginTop: 10,
    minHeight: 72,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.inputBorder,
    backgroundColor: t.input,
    color: t.foreground,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  commentActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
}));
