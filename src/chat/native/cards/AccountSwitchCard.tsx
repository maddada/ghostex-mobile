/**
 * The account-switch card centered over the chat while a Claude or Codex account switch runs,
 * drawn from `accountSwitchCard`. Port of desktop `account_switch_card.rs` (React's
 * `account-switch-card.tsx`): heading and lede, a From / To line per account over its usage
 * tiles, and numbered steps with a moving line under the active one, or the failure with Retry.
 * A switch in flight blocks the chat behind it; a failed one lets touches through.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { RustChat } from '../../rust/useRustChat';
import { AgentMark } from './agentMark';
import { Glyph } from './icons';
import { arr, isTrue, num, obj, str } from './json';
import { ChatCardPalette as P } from './palette';
import { ChatButton, useLoop } from './primitives';

const SURFACE = '#181818';
const TILE = '#1f1f1f';
const LINE = 'rgba(252,252,252,0.10)';
const TRACK = 'rgba(252,252,252,0.09)';

export function AccountSwitchCard({ chat }: { chat: RustChat }) {
  const card = obj(chat.state?.document?.accountSwitchCard);
  const appear = useRef(new Animated.Value(0)).current;
  const id = str(card, 'id');
  useEffect(() => {
    if (id.length === 0) return;
    appear.setValue(0);
    Animated.timing(appear, { toValue: 1, duration: 260, easing: Easing.out(Easing.poly(5)), useNativeDriver: true }).start();
  }, [appear, id]);
  if (card === null) return null;

  const provider = str(card, 'provider') || 'claude';
  const verified = isTrue(card, 'verified');
  const failed = (str(card, 'phase') || 'switching') === 'failed';
  const steps = Array.isArray(card.steps) ? card.steps : null;
  const retry = obj(card.retry);

  let footer: ReactNode;
  if (steps !== null) {
    footer = (
      <View accessibilityRole="list" style={styles.steps}>
        {steps.map((step, index) => (
          <Step key={index} index={index} step={step} />
        ))}
      </View>
    );
  } else {
    footer = (
      <View accessibilityRole="alert" style={styles.failure}>
        <Text style={styles.failureText}>{str(card, 'failure')}</Text>
        {retry !== null ? (
          <View style={styles.retryRow}>
            <ChatButton
              icon="refresh"
              label="Retry switch"
              disabled={retry.busy === true}
              onPress={() =>
                chat.dispatch({ type: 'accounts', request: { operation: 'select', accountId: str(retry, 'accountId') } })
              }
            />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <Animated.View
      pointerEvents={failed ? 'box-none' : 'auto'}
      style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: appear }]}
    >
      <ScrollView contentContainerStyle={styles.scroll} pointerEvents="box-none">
        <Animated.View
          accessibilityLabel="Account switch status"
          style={[
            styles.card,
            { transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] },
          ]}
        >
          <View accessibilityRole="text">
            <Text style={styles.heading}>{str(card, 'heading')}</Text>
            <Text style={styles.lede}>{str(card, 'lede')}</Text>
          </View>
          <Account value={card.from} provider={provider} verified={verified} />
          <Account value={card.to} provider={provider} verified={verified} />
          {footer}
        </Animated.View>
      </ScrollView>
    </Animated.View>
  );
}

function Account({ value, provider, verified }: { value: unknown; provider: string; verified: boolean }) {
  const target = isTrue(value, 'target');
  const role = target ? (verified ? 'Active' : 'To') : verified ? 'Previous' : 'From';
  return (
    <View style={styles.account}>
      <View style={styles.accountLine}>
        <AgentMark icon={provider} size={14} />
        <Text style={[styles.role, target && { color: P.accent }]}>{role}</Text>
        <Text style={styles.accountLabel} numberOfLines={1}>
          {str(value, 'label')}
        </Text>
        {target && verified ? <Glyph name="check" size={13} color={P.accent} /> : null}
      </View>
      <View style={styles.tiles}>
        {arr(obj(value)?.usage).map((usage, index) => (
          <UsageTile key={index} usage={usage} target={target} />
        ))}
      </View>
    </View>
  );
}

function UsageTile({ usage, target }: { usage: unknown; target: boolean }) {
  const level = str(usage, 'level') || 'unknown';
  const used = num(usage, 'used');
  const strong = level === 'high' || level === 'exhausted';
  const ink = { moderate: 0.5, high: 0.72, exhausted: 1 }[level] ?? 0.3;
  const fill = target ? 'rgba(134,211,248,0.7)' : `rgba(252,252,252,${ink})`;
  const reset = str(usage, 'reset');
  return (
    <View style={[styles.tile, level === 'exhausted' && { borderColor: 'rgba(252,252,252,0.35)' }]}>
      <View style={styles.tileText}>
        <Text style={styles.tileLabel} numberOfLines={1}>
          {str(usage, 'label')}
        </Text>
        <Text style={styles.tileReset} numberOfLines={1}>
          {reset.length > 0 ? reset : '–'}
        </Text>
      </View>
      <Text
        style={[
          styles.tilePercent,
          strong && styles.tilePercentStrong,
          level === 'unknown' && { color: P.muted },
        ]}
      >
        {used === null ? '–' : String(Math.round(used))}
        {used !== null ? <Text style={styles.tilePercentSign}>%</Text> : null}
      </Text>
      {used !== null ? (
        <View style={[styles.tileBar, { width: `${Math.max(0, Math.min(100, used))}%`, backgroundColor: fill }]} />
      ) : null}
    </View>
  );
}

function Step({ index, step }: { index: number; step: unknown }) {
  const state = str(step, 'state') || 'pending';
  const sweep = useLoop(1600, Easing.inOut(Easing.cubic), state === 'active');
  const color = state === 'active' ? P.foreground : state === 'done' ? P.prose : P.muted;
  const grow = [1, 1.3, 1.1][index] ?? 1;
  return (
    <View style={[styles.step, { flexGrow: grow }]}>
      <View
        style={[
          styles.stepNumber,
          state === 'active' && { backgroundColor: P.foreground, borderColor: 'transparent' },
          state === 'done' && { backgroundColor: 'rgba(134,211,248,0.22)', borderColor: 'transparent' },
        ]}
      >
        {state === 'done' ? (
          <Glyph name="check" size={10} color={P.accent} />
        ) : (
          <Text style={[styles.stepNumberText, state === 'active' && { color: SURFACE }]}>{index + 1}</Text>
        )}
      </View>
      <Text style={[styles.stepLabel, { color }]} numberOfLines={1}>
        {str(step, 'label')}
      </Text>
      <View style={[styles.stepLine, state === 'done' && { backgroundColor: 'rgba(134,211,248,0.55)' }]}>
        {state === 'active' ? (
          <Animated.View
            style={[
              styles.stepSweep,
              { transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-40, 110] }) }] },
            ]}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: P.backdrop,
    zIndex: 20,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  card: {
    width: '100%',
    maxWidth: 430,
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: LINE,
    backgroundColor: SURFACE,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 12 },
  },
  heading: {
    color: P.foreground,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  lede: {
    marginTop: 2,
    color: P.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  account: {
    gap: 6,
  },
  accountLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  role: {
    minWidth: 30,
    color: P.muted,
    fontSize: 11,
  },
  accountLabel: {
    flexShrink: 1,
    color: P.foreground,
    fontSize: 12,
    fontWeight: '500',
  },
  tiles: {
    flexDirection: 'row',
    gap: 6,
  },
  tile: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingTop: 6,
    paddingHorizontal: 8,
    paddingBottom: 8,
    overflow: 'hidden',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: LINE,
    backgroundColor: TILE,
  },
  tileText: {
    flex: 1,
    minWidth: 0,
  },
  tileLabel: {
    color: P.muted,
    fontSize: 11,
    lineHeight: 14,
  },
  tileReset: {
    color: P.muted,
    fontSize: 10,
    lineHeight: 13,
  },
  tilePercent: {
    color: P.prose,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '500',
  },
  tilePercentStrong: {
    color: P.foreground,
    fontWeight: '600',
  },
  tilePercentSign: {
    color: P.muted,
    fontSize: 10,
    fontWeight: '500',
  },
  tileBar: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: 2,
  },
  steps: {
    flexDirection: 'row',
    gap: 6,
    paddingTop: 2,
  },
  step: {
    flexBasis: 0,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 7,
  },
  stepNumber: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: LINE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: {
    color: P.muted,
    fontSize: 10,
  },
  stepLabel: {
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 15,
  },
  stepLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: TRACK,
  },
  stepSweep: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 40,
    borderRadius: 2,
    backgroundColor: P.accent,
  },
  failure: {
    gap: 10,
  },
  failureText: {
    paddingVertical: 2,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: P.foreground,
    color: P.prose,
    fontSize: 12,
    lineHeight: 17,
  },
  retryRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
});
