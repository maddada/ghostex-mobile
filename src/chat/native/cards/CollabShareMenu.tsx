/**
 * The phone's Share sheet (Ghostex Collab), opened from the chat's Share pill. The same design as
 * the desktop's Share popover (apps/desktop/src/app/window/share_popover_view.rs), with touch-size
 * rows and the system share sheet for the link:
 *
 * - a status band on top: Collab isn't installed, Installing, Not shared, Creating the link, Live
 *   (who is watching, a waiting message, when it ends or that it stays live until stopped), Stop
 *   sharing?, Sharing ended;
 * - Collab not installed: Install right here (the computer downloads it once the owner approves,
 *   on the computer or this phone), its progress, then "Ready to share"; or "Don't show Share";
 * - Ready: what guest messages do, how long a link lasts (the chip also changes the default, with
 *   "Until I stop it"), Create link;
 * - Live: the link and code (kept for this run of the app; Show asks for approval after a
 *   restart), who is watching with Remove, a guest's waiting message with Review (its card waits
 *   above the chat box), the guest-message mode, Share link… and Stop sharing (asks first, naming
 *   who gets disconnected).
 *
 * Read from and saved to that computer's `/api/collab` (forwarded to its Collab component) and
 * `/api/extensionComponents`.
 *
 * CDXC:Collab 2026-11-07 DECISION: User (Q1616): the phone is "full (share, approve messages, Stop sharing, see viewers)", starting a share included.
 *
 * CDXC:Collab 2026-11-08 DECISION: User (Q1780-Q1786): the live panel, Install in the sheet, Share before install with "Don't show Share", Review points at the card, Stop asks first, the lifetime chip with "Until I stop it", "The same design on the phone (the phone keeps its Share link button)". Installing, sharing, Send mode and sending a guest's message need the owner's signed approval (`collabCall` waits for it). No read returns a link or a code.
 */

import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Share, Text, View } from 'react-native';

import type { ChatDocument } from '../../rust/document';
import { collabCall, revealedShares, spacedCode } from './collabCall';
import type { RustChat } from '../../rust/useRustChat';
import { Glyph, type GlyphName } from './icons';
import { obj, str } from './json';
import {
  LIFETIMES,
  MODES,
  endsIn,
  joined,
  liveSubtitle,
  modeLine,
  names,
  stageOf,
  type Share_,
  type View_,
} from './collabShareStage';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';

/** `#rrggbb` at `alpha`, for the glass washes. */
function ink(hex: string, alpha: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const value = parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function cardColors(foreground: string) {
  return { backgroundColor: ink(foreground, 0.055), borderColor: ink(foreground, 0.09) };
}

function Band({
  icon,
  spinning,
  title,
  subtitle,
  live,
}: {
  icon: GlyphName;
  spinning?: boolean;
  title: string;
  subtitle: string;
  live?: boolean;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const dim = ink(P.foreground, 0.03);
  return (
    <View style={[styles.band, { backgroundColor: dim, borderColor: ink(P.foreground, 0.07) }]}>
      <View style={[styles.tile, { backgroundColor: ink(P.foreground, 0.09) }]}>
        {spinning ? (
          <ActivityIndicator size="small" color={P.foreground} />
        ) : (
          <Glyph name={icon} size={20} color={P.foreground} />
        )}
      </View>
      <View style={styles.bandText}>
        <View style={styles.row}>
          {live ? <View style={[styles.dot, { backgroundColor: P.light ? '#1f9d55' : '#4ade80' }]} /> : null}
          <Text style={styles.bandTitle}>{title}</Text>
        </View>
        <Text style={styles.bandSub} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

function Button({
  label,
  icon,
  kind,
  onPress,
  disabled,
  full,
}: {
  label: string;
  icon?: GlyphName;
  kind: 'primary' | 'normal' | 'ghost' | 'danger';
  onPress: () => void;
  disabled?: boolean;
  full?: boolean;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const primary = kind === 'primary';
  const color = primary
    ? P.background
    : kind === 'danger'
      ? P.light
        ? '#b8322c'
        : '#f0928e'
      : kind === 'ghost'
        ? P.muted
        : P.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled === true}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.button,
        full && styles.full,
        {
          backgroundColor: primary
            ? P.controlPrimary
            : kind === 'ghost'
              ? 'transparent'
              : ink(P.foreground, pressed ? 0.14 : 0.09),
          borderColor: primary ? P.controlPrimary : kind === 'ghost' ? 'transparent' : ink(P.foreground, 0.12),
        },
        pressed && primary && { opacity: 0.88 },
        disabled === true && { opacity: 0.45 },
      ]}
    >
      {icon !== undefined ? <Glyph name={icon} size={15} color={color} /> : null}
      <Text style={[styles.buttonLabel, { color }, primary && styles.bold]}>{label}</Text>
    </Pressable>
  );
}

function Fact({ icon, text }: { icon: GlyphName; text: string }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <View style={styles.fact}>
      <View style={[styles.factTile, { backgroundColor: ink(P.foreground, 0.07) }]}>
        <Glyph name={icon} size={15} color={P.foreground} />
      </View>
      <Text style={styles.factText}>{text}</Text>
    </View>
  );
}

function WaitCard({ what }: { what: string }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const card = cardColors(P.foreground);
  return (
    <View style={[styles.card, styles.waitCard, card]}>
      <View style={[styles.waitIcon, { backgroundColor: ink(P.foreground, 0.08) }]}>
        <Glyph name="lock" size={15} color={P.foreground} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.waitTitle}>Waiting for your approval</Text>
        <Text style={styles.small}>{`${what}: on your computer, or this phone`}</Text>
      </View>
    </View>
  );
}

function Modes({ selected, onPick }: { selected: string; onPick: (value: string) => void }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      style={[styles.segments, { backgroundColor: ink(P.foreground, 0.06), borderColor: ink(P.foreground, 0.08) }]}
    >
      {MODES.map((option) => {
        const on = option.value === selected;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => onPick(option.value)}
            style={[styles.segment, on && { backgroundColor: ink(P.foreground, 0.15) }]}
          >
            {option.value === 'send' ? <Glyph name="lock" size={12} color={on ? P.foreground : P.muted} /> : null}
            <Text style={[styles.segmentText, { color: on ? P.foreground : P.muted }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function CollabShareMenu({
  chat,
  document,
  onDone,
}: {
  chat: RustChat;
  document: ChatDocument;
  onDone?: () => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const collab = obj(document.collab);
  const projectId = collab ? str(collab, 'projectId') : '';
  const sessionId = collab ? str(collab, 'sessionId') : '';
  const machine = chat.machine;
  const [view, setView] = useState<View_ | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [waitingKind, setWaitingKind] = useState<'install' | 'create' | 'other' | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [lifetimeOpen, setLifetimeOpen] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [justStopped, setJustStopped] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const read = useCallback(async () => {
    if (machine === null) return;
    const answer = await collabCall(machine, { op: 'read' }, undefined, () => alive.current);
    if (answer.result !== null && alive.current) setView(answer.result as unknown as View_);
  }, [machine]);

  /** One change; `kind` says it may wait for the owner's approval (and which band says so). */
  const change = useCallback(
    async (
      params: Record<string, unknown>,
      kind: 'install' | 'create' | 'other' | null,
      endpoint: 'collab' | 'extensionComponents' = 'collab',
    ): Promise<Record<string, unknown> | null> => {
      if (machine === null) return null;
      setBusy(true);
      setError(null);
      if (kind !== null) setWaitingKind(kind);
      try {
        const answer = await collabCall(
          machine,
          params,
          kind !== null ? setWaiting : undefined,
          () => alive.current,
          endpoint,
        );
        if (answer.error !== null) {
          setError(answer.error);
          return null;
        }
        const share = answer.result.share as { shareId?: string; link?: string; code?: string } | undefined;
        if (share?.shareId && share.link && share.code) {
          revealedShares.set(share.shareId, { link: share.link, code: share.code });
        }
        return answer.result;
      } finally {
        if (alive.current) {
          setBusy(false);
          setWaiting(null);
          setWaitingKind(null);
          void read();
        }
      }
    },
    [machine, read],
  );

  const installing = view?.component?.phase === 'downloading' || view?.component?.phase === 'installing';
  useEffect(() => {
    void read();
    const timer = setInterval(() => void read(), installing ? 1_000 : 3_000);
    return () => clearInterval(timer);
  }, [read, installing]);

  const copy = (what: string, text: string) => {
    void Clipboard.setStringAsync(text);
    setCopied(what);
    setTimeout(() => setCopied((current) => (current === what ? null : current)), 1600);
  };

  const stage = stageOf(view, projectId, sessionId, { confirmStop, justStopped, waiting: waitingKind });
  const newMode = mode ?? view?.config?.mode ?? 'approve';
  const lifetime = view?.config?.expiry ?? 'hour';
  const connected = view?.relayConnected === true;

  const facts = (faded: boolean) => (
    <View style={[styles.facts, faded && styles.faded]}>
      <Fact icon="world" text="Opens live in any browser, no app or account" />
      <Fact icon="lock" text="Guests also type the eight-digit code" />
      <Fact icon="shield-check" text="You approve each message before the agent sees it" />
    </View>
  );

  const card = cardColors(P.foreground);

  const notes = (
    <>
      {error !== null ? <Text style={styles.error}>{error}</Text> : null}
      {view?.guestPage?.message ? <Text style={styles.error}>{view.guestPage.message}</Text> : null}
    </>
  );

  if (stage.kind === 'loading') {
    return <Text style={styles.note}>{error ?? 'Reading Ghostex Collab…'}</Text>;
  }

  if (stage.kind === 'notInstalled') {
    return (
      <View style={styles.menu}>
        <Band icon="puzzle" title="Collab isn't installed" subtitle="It's an extension: Ghostex downloads it once" />
        <View style={styles.body}>
          {facts(false)}
          {stage.canInstall ? (
            <Button
              label="Install Collab"
              icon="download"
              kind="primary"
              full
              disabled={busy}
              onPress={() => void change({ op: 'install', name: 'collab' }, 'install', 'extensionComponents')}
            />
          ) : (
            <Text style={styles.small}>This computer's Ghostex has no Collab component to install.</Text>
          )}
          <Text style={[styles.small, styles.center]}>
            Installing asks for your approval, on your computer or this phone
          </Text>
          {notes}
        </View>
        <View style={[styles.footer, styles.centerRow, { borderColor: ink(P.foreground, 0.08) }]}>
          <Button
            label="Don't show Share"
            icon="eye-off"
            kind="ghost"
            onPress={() =>
              void change({ op: 'hideShare', hidden: true }, null).then((done) => {
                if (done !== null) onDone?.();
              })
            }
          />
        </View>
      </View>
    );
  }

  if (stage.kind === 'installWaiting') {
    return (
      <View style={styles.menu}>
        <Band
          icon="download"
          spinning
          title="Installing Collab…"
          subtitle="Approve on your computer, or on this phone"
        />
        <View style={styles.body}>
          {facts(true)}
          <WaitCard what={waiting ?? 'Install Collab'} />
          {notes}
        </View>
      </View>
    );
  }

  if (stage.kind === 'installing') {
    const percent = stage.fraction === null ? null : Math.floor(stage.fraction * 100);
    return (
      <View style={styles.menu}>
        <Band
          icon="download"
          title={percent === null ? 'Installing Collab…' : 'Downloading Collab…'}
          subtitle={
            percent === null
              ? 'It starts on your computer in a moment'
              : `${percent}% · then it starts on your computer`
          }
        />
        <View style={styles.body}>
          <View style={[styles.bar, { backgroundColor: ink(P.foreground, 0.1) }]}>
            <View style={[styles.barFill, { width: `${percent ?? 100}%`, backgroundColor: ink(P.foreground, 0.8) }]} />
          </View>
          <Text style={[styles.small, styles.center]}>You can close this; Share is ready when it finishes</Text>
        </View>
      </View>
    );
  }

  if (stage.kind === 'notRunning') {
    return (
      <View style={styles.menu}>
        <Band icon="puzzle" spinning title="Collab is starting…" subtitle="It restarts on its own" />
        {stage.reason ? <Text style={styles.note}>{stage.reason}</Text> : null}
      </View>
    );
  }

  if (stage.kind === 'ready' || stage.kind === 'creating') {
    const creating = stage.kind === 'creating';
    const lifetimeLabel = LIFETIMES.find((entry) => entry.value === lifetime)?.label ?? '1 hour';
    return (
      <View style={styles.menu}>
        {creating ? (
          <Band icon="link" spinning title="Creating the link…" subtitle="Approve on your computer, or on this phone" />
        ) : (
          <Band icon="eye-off" title="Not shared" subtitle="Only you can see this chat" />
        )}
        <View style={styles.body}>
          <View style={[styles.options, creating && styles.faded]}>
            <Text style={styles.section}>Guest messages</Text>
            <Modes
              selected={newMode}
              onPick={(value) => {
                setMode(value);
                // Ask me and View only are also the default; Send never is.
                if (value !== 'send') void change({ op: 'set', patch: { mode: value } }, null);
              }}
            />
            <Text style={styles.small}>{modeLine(newMode)}</Text>
            <View style={styles.rowBetween}>
              <Text style={styles.small}>Link lasts</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Link lasts ${lifetimeLabel}`}
                onPress={() => setLifetimeOpen((open) => !open)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: ink(P.foreground, lifetimeOpen ? 0.14 : 0.08),
                    borderColor: ink(P.foreground, 0.1),
                  },
                ]}
              >
                <Text style={styles.chipText}>{lifetimeLabel}</Text>
                <Glyph name="chevron-down" size={13} color={P.muted} />
              </Pressable>
            </View>
            {lifetimeOpen ? (
              <View style={[styles.card, styles.menuList, card]}>
                {LIFETIMES.map((entry) => (
                  <Pressable
                    key={entry.value}
                    accessibilityRole="menuitem"
                    onPress={() => {
                      setLifetimeOpen(false);
                      // CDXC:Collab 2026-11-08 DECISION: User (Q1785) "A chip before Create link (changes the default too)".
                      setView((current) =>
                        current?.config ? { ...current, config: { ...current.config, expiry: entry.value } } : current,
                      );
                      void change({ op: 'set', patch: { expiry: entry.value } }, null);
                    }}
                    style={[styles.menuItem, entry.value === lifetime && { backgroundColor: ink(P.foreground, 0.12) }]}
                  >
                    <Text style={styles.chipText}>{entry.label}</Text>
                    {entry.value === lifetime ? <Glyph name="check" size={14} color={P.foreground} /> : null}
                  </Pressable>
                ))}
              </View>
            ) : null}
            {lifetime === 'untilStopped' ? (
              <Text style={styles.small}>The link stays live until you stop sharing or delete the chat.</Text>
            ) : null}
          </View>
          {creating ? (
            <WaitCard what={waiting ?? 'Create the link'} />
          ) : (
            <Button
              label="Create link"
              icon="link"
              kind="primary"
              full
              disabled={busy || projectId.length === 0}
              onPress={() => {
                setJustStopped(false);
                void change({ op: 'share', projectId, sessionId }, 'create').then((result) => {
                  const shareId = (result?.share as { shareId?: string } | undefined)?.shareId;
                  // Send was picked before the link existed: turned on now, with its own approval.
                  if (shareId && newMode === 'send') void change({ op: 'setMode', shareId, mode: 'send' }, 'other');
                });
              }}
            />
          )}
          {notes}
        </View>
      </View>
    );
  }

  if (stage.kind === 'ended') {
    return (
      <View style={styles.menu}>
        <Band icon="eye-off" title="Sharing ended" subtitle="Only you can see this chat again" />
        <View style={styles.body}>
          <Button
            label="Create a new link"
            icon="link"
            kind="normal"
            full
            disabled={busy}
            onPress={() => {
              setJustStopped(false);
              void change({ op: 'share', projectId, sessionId }, 'create');
            }}
          />
          {notes}
        </View>
      </View>
    );
  }

  const share = stage.share;
  if (stage.kind === 'confirmStop') {
    const who = names(share.viewers);
    return (
      <View style={styles.menu}>
        <Band icon="player-stop" title="Stop sharing?" subtitle="The link and code stop working" />
        <Text style={styles.confirm}>
          {who === null
            ? 'Nobody is watching. You can make a new link any time.'
            : `${who} see “Sharing ended” and can't come back with this link. You can make a new link any time.`}
        </Text>
        <View style={[styles.footer, styles.endRow, { borderColor: ink(P.foreground, 0.08) }]}>
          <Button label="Keep sharing" kind="normal" onPress={() => setConfirmStop(false)} />
          <Button
            label="Stop sharing"
            icon="player-stop"
            kind="danger"
            disabled={busy}
            onPress={() =>
              void change({ op: 'stop', shareId: share.shareId }, null).then((done) => {
                setConfirmStop(false);
                if (done !== null) setJustStopped(true);
              })
            }
          />
        </View>
      </View>
    );
  }

  const revealed = revealedShares.get(share.shareId);
  const waitingIds = share.waitingViewerIds ?? [];
  const fresh = revealed !== undefined && share.viewers.length === 0;
  const shownLink = revealed?.link.replace(/^https?:\/\//, '') ?? '';
  return (
    <View style={styles.menu}>
      <Band icon="users" title="Live" live={connected} subtitle={liveSubtitle(share, connected)} />
      <View style={styles.body}>
        {revealed === undefined ? (
          <>
            <View style={[styles.card, styles.inviteRow, card]}>
              <Glyph name="eye-off" size={15} color={P.muted} />
              <Text style={[styles.flex, styles.small]}>Link and code hidden</Text>
              <Button
                label="Show"
                icon="lock"
                kind="normal"
                disabled={busy}
                onPress={() => void change({ op: 'share', projectId, sessionId }, 'other')}
              />
            </View>
            <Text style={styles.small}>Showing them again asks for your approval.</Text>
          </>
        ) : fresh ? (
          <>
            <View style={[styles.card, card, styles.invite]}>
              <View style={styles.inviteLine}>
                <Text style={styles.inviteLabel}>Link</Text>
                <Text selectable numberOfLines={1} style={[styles.flex, styles.link]}>
                  {shownLink}
                </Text>
                <Button
                  label={copied === 'link' ? 'Copied' : 'Copy'}
                  icon={copied === 'link' ? 'check' : 'copy'}
                  kind="normal"
                  onPress={() => copy('link', revealed.link)}
                />
              </View>
              <View style={[styles.inviteLine, styles.inviteTop, { borderColor: ink(P.foreground, 0.07) }]}>
                <Text style={styles.inviteLabel}>Code</Text>
                <Text selectable style={[styles.flex, styles.code]}>
                  {spacedCode(revealed.code)}
                </Text>
                <Button
                  label={copied === 'code' ? 'Copied' : 'Copy'}
                  icon={copied === 'code' ? 'check' : 'copy'}
                  kind="normal"
                  onPress={() => copy('code', revealed.code)}
                />
              </View>
            </View>
            <Text style={styles.small}>Send the code another way than the link: guests need both.</Text>
          </>
        ) : (
          <View style={[styles.card, styles.inviteRow, card]}>
            <Glyph name="link" size={15} color={P.muted} />
            <Text numberOfLines={1} style={[styles.flex, styles.link]}>
              {shownLink}
            </Text>
            <Button
              label={copied === 'link' ? 'Copied' : 'Link'}
              icon={copied === 'link' ? 'check' : 'copy'}
              kind="normal"
              onPress={() => copy('link', revealed.link)}
            />
            <Button
              label={copied === 'code' ? 'Copied' : 'Code'}
              icon={copied === 'code' ? 'check' : 'copy'}
              kind="normal"
              onPress={() => copy('code', revealed.code)}
            />
          </View>
        )}
        {share.viewers.length > 0 ? (
          <>
            <Text style={styles.section}>Watching</Text>
            {share.viewers.map((viewer) => {
              const isWaiting = waitingIds.includes(viewer.id);
              return (
                <View key={viewer.id} style={styles.guest}>
                  <View style={[styles.avatar, { backgroundColor: ink(P.foreground, 0.1) }]}>
                    <Glyph name="user" size={15} color={P.foreground} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.guestName} numberOfLines={1}>
                      {viewer.name}
                    </Text>
                    <Text style={styles.small}>{isWaiting ? 'Message waiting' : joined(viewer.joinedAtMs)}</Text>
                  </View>
                  {isWaiting ? (
                    // CDXC:Collab 2026-11-08 DECISION: User (Q1783) "Point at the card": the message's card waits above the chat box.
                    <Button label="Review" kind="primary" onPress={() => onDone?.()} />
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${viewer.name}`}
                      hitSlop={8}
                      onPress={() =>
                        void change({ op: 'removeViewer', shareId: share.shareId, viewerId: viewer.id }, null)
                      }
                      style={styles.remove}
                    >
                      <Glyph name="x" size={16} color={P.muted} />
                    </Pressable>
                  )}
                </View>
              );
            })}
          </>
        ) : null}
        <Text style={styles.section}>Guest messages</Text>
        <Modes
          selected={share.mode}
          onPick={(value) => void change({ op: 'setMode', shareId: share.shareId, mode: value }, 'other')}
        />
        {waiting !== null && waitingKind === 'other' ? <WaitCard what={waiting} /> : null}
        {notes}
      </View>
      <View style={[styles.footer, styles.rowBetween, { borderColor: ink(P.foreground, 0.08) }]}>
        {revealed !== undefined ? (
          <Button
            label="Share link…"
            icon="send"
            kind="normal"
            onPress={() => void Share.share({ message: `${revealed.link}\nCode: ${revealed.code}` })}
          />
        ) : (
          <View style={styles.row}>
            <Glyph name="clock" size={14} color={P.muted} />
            <Text style={styles.small}>{endsIn(share.expiresAtMs)}</Text>
          </View>
        )}
        <Button
          label="Stop sharing"
          icon="player-stop"
          kind="normal"
          disabled={busy}
          onPress={() => setConfirmStop(true)}
        />
      </View>
    </View>
  );
}

const useStyles = themedStyles((P) => ({
  menu: { paddingBottom: 4 },
  body: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14, gap: 12 },
  note: { color: P.muted, fontSize: 14, lineHeight: 20, paddingHorizontal: 16, paddingVertical: 8 },
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  tile: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  bandText: { flex: 1, minWidth: 0 },
  bandTitle: { color: P.foreground, fontSize: 16, fontWeight: '650' as never },
  bandSub: { color: P.muted, fontSize: 13.5, marginTop: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  centerRow: { justifyContent: 'center' },
  endRow: { justifyContent: 'flex-end' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  facts: { gap: 9 },
  faded: { opacity: 0.42 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  factTile: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  factText: { flex: 1, color: P.foreground, fontSize: 14 },
  options: { gap: 10 },
  section: { color: P.muted, fontSize: 12.5, marginBottom: -4 },
  small: { color: P.muted, fontSize: 13 },
  center: { textAlign: 'center' },
  flex: { flex: 1, minWidth: 0 },
  bold: { fontWeight: '600' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  full: { alignSelf: 'stretch', height: 40 },
  buttonLabel: { fontSize: 14 },
  segments: { flexDirection: 'row', padding: 2, borderRadius: 8, borderWidth: 1 },
  segment: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
    justifyContent: 'center',
    height: 32,
    borderRadius: 6,
  },
  segmentText: { fontSize: 13.5 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 7,
    borderWidth: 1,
  },
  chipText: { color: P.foreground, fontSize: 14 },
  menuList: { padding: 4, alignSelf: 'flex-end', width: 180 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  card: { borderRadius: 10, borderWidth: 1 },
  waitCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  waitIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  waitTitle: { color: P.foreground, fontSize: 14, fontWeight: '600' },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  invite: { paddingHorizontal: 12, paddingVertical: 4 },
  inviteLine: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
  inviteTop: { borderTopWidth: 1 },
  inviteLabel: { width: 36, color: P.muted, fontSize: 13 },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 6,
  },
  link: { color: P.foreground, fontSize: 13, fontFamily: 'Menlo' },
  code: { color: P.foreground, fontSize: 20, fontWeight: '600', letterSpacing: 2 },
  guest: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  guestName: { color: P.foreground, fontSize: 15, fontWeight: '600' },
  remove: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  confirm: { color: P.foreground, fontSize: 14.5, lineHeight: 21, paddingHorizontal: 16, paddingVertical: 14 },
  error: { color: P.light ? '#b8322c' : '#ef9999', fontSize: 13 },
}));
