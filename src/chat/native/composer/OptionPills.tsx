/**
 * The pills under the composer (`option_pills.rs`): the model pill (with the agent's mark and, for
 * the merged picker, the reasoning suffix), the options pill, the permission mode pill, and the
 * context meter ring. Each opens its menu; the menus are the document's rows.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { AGENT_ICONS } from '../../../assets/agentIcons.generated';
import type { ChatDocument } from '../../rust/document';
import { agentAccent } from './agentColors';
import { Glyph, ModeGlyph } from './icons';
import { arr, isTrue, num, obj, str } from './json';
import { ComposerPalette as P } from './palette';

export type PillKind = 'model' | 'options' | 'mode' | 'context';

const MODE_COLORS: Record<string, [mode: 'advance' | 'pause', color: string]> = {
  'accept-edits': ['advance', '#d3bff8'],
  auto: ['advance', '#f6daa0'],
  bypass: ['advance', '#ffb6c5'],
  manual: ['pause', '#d2d4dc'],
  plan: ['pause', '#a6ddd8'],
};

export function OptionPills({ document, onOpen }: { document: ChatDocument; onOpen: (kind: PillKind) => void }) {
  const labels = obj(document.optionLabels);
  const modelMenu = obj(document.modelMenu);
  const merged = modelMenu !== null;
  const optionsOverflowed = document.composerOverflow?.optionsOverflowed === true;
  const loadingModel = str(labels, 'model').length === 0;
  const modelLabel = (merged ? str(obj(modelMenu?.pill), 'label') : '') || str(labels, 'modelDisplay') || str(labels, 'model');
  const suffix = merged && !loadingModel ? str(obj(modelMenu?.pill), 'suffix') : '';
  const agentIcon = str(labels, 'agentIcon');
  const AgentIcon = agentIcon.length > 0 ? AGENT_ICONS[agentIcon] : undefined;
  const indicator = str(labels, 'accountIndicator');
  const hasMode = arr(obj(document.optionMenus)?.mode).length > 0;
  const modeValue = str(labels, 'modeValue');
  const [modeGlyph, modeColor] = MODE_COLORS[modeValue] ?? ['pause', '#d2d4dc'];
  const optionsLabel = str(labels, 'options');
  const context = obj(document.contextMeter);
  const badges = (
    <>
      {isTrue(labels, 'fast') ? <Glyph name="bolt" size={13} color={P.primary} /> : null}
      {isTrue(labels, 'plan') ? <Glyph name="map" size={13} color={P.primary} /> : null}
    </>
  );
  return (
    <View style={styles.row}>
      {isTrue(labels, 'showModel') ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={loadingModel ? 'Reading model' : `Model: ${modelLabel}`}
          onPress={() => onOpen('model')}
          style={({ pressed }) => [styles.pill, merged ? styles.pillMerged : null, pressed ? styles.pressed : null]}
        >
          {AgentIcon !== undefined ? (
            indicator.length > 0 ? (
              <View style={styles.accountMark}>
                <View style={styles.accountLogo}>
                  <AgentIcon size={19} color={agentAccent(agentIcon)} />
                </View>
                <Text style={[styles.accountIndicator, agentIcon === 'codex' ? styles.accountIndicatorCodex : null]}>{indicator}</Text>
              </View>
            ) : (
              <AgentIcon size={14} color={agentAccent(agentIcon)} />
            )
          ) : null}
          {loadingModel ? (
            <View style={[styles.skeleton, { width: 52 }]} />
          ) : (
            <Text style={styles.pillText} numberOfLines={1}>
              {modelLabel}
              {suffix.length > 0 ? <Text style={styles.suffix}>{`  ${suffix}`}</Text> : null}
            </Text>
          )}
          {merged && !loadingModel ? badges : null}
          <Glyph name="chevron-down" size={12} color={P.primary} />
        </Pressable>
      ) : null}
      {isTrue(labels, 'showOptions') && !merged && !optionsOverflowed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={optionsLabel.length > 0 ? `Options: ${optionsLabel}` : 'Reading options'}
          disabled={optionsLabel.length === 0}
          onPress={() => onOpen('options')}
          style={({ pressed }) => [styles.pill, pressed ? styles.pressed : null]}
        >
          {optionsLabel.length === 0 ? (
            <View style={[styles.skeleton, { width: 36 }]} />
          ) : (
            <Text style={styles.pillText} numberOfLines={1}>
              {optionsLabel}
            </Text>
          )}
          {optionsLabel.length > 0 ? badges : null}
          <Glyph name="chevron-down" size={12} color={P.primary} />
        </Pressable>
      ) : null}
      {hasMode ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Mode: ${str(labels, 'mode')}`}
          onPress={() => onOpen('mode')}
          style={({ pressed }) => [styles.pill, styles.modePill, pressed ? styles.pressed : null]}
        >
          <View style={styles.modeGlyph}>
            <ModeGlyph mode={modeGlyph} color={modeColor} />
          </View>
        </Pressable>
      ) : null}
      {context !== null && !optionsOverflowed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={str(context, 'label')}
          onPress={() => onOpen('context')}
          style={({ pressed }) => [styles.ring, pressed ? styles.pressed : null]}
        >
          <ContextRing percentage={num(context, 'usedPercentage') ?? 0} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** The context meter's ring (`context_meter.rs`, `ring`): a muted track and the used arc. */
export function ContextRing({ percentage }: { percentage: number }) {
  const radius = 6.5;
  const circumference = 2 * Math.PI * radius;
  const fraction = Math.min(1, Math.max(0, percentage / 100));
  return (
    <Svg width={17} height={17} viewBox="0 0 17 17">
      <Circle cx={8.5} cy={8.5} r={radius} stroke="rgba(158,158,158,0.24)" strokeWidth={2} fill="none" />
      {fraction > 0 ? (
        <Circle
          cx={8.5}
          cy={8.5}
          r={radius}
          stroke="#b9b9b9"
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference * fraction} ${circumference}`}
          transform="rotate(-90 8.5 8.5)"
        />
      ) : null}
    </Svg>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 1, minWidth: 0 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 15,
    maxWidth: 160,
    flexShrink: 1,
    minWidth: 0,
  },
  pillMerged: { maxWidth: 230 },
  pressed: { backgroundColor: P.border },
  pillText: { color: P.primary, fontSize: 13, flexShrink: 1 },
  suffix: { color: 'rgba(158,158,158,0.8)' },
  skeleton: { height: 10, borderRadius: 5, backgroundColor: 'rgba(180,184,192,0.24)' },
  modePill: { paddingHorizontal: 7 },
  modeGlyph: { opacity: 0.55 },
  ring: { width: 30, height: 30, marginLeft: 4, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  accountMark: { width: 19, height: 19, marginRight: 2, alignItems: 'center', justifyContent: 'center' },
  accountLogo: { ...StyleSheet.absoluteFill, opacity: 0.3, alignItems: 'center', justifyContent: 'center' },
  accountIndicator: { color: P.muted, fontFamily: 'Menlo', fontSize: 9.9, fontWeight: '600' },
  accountIndicatorCodex: { color: '#7db8fb' },
});
