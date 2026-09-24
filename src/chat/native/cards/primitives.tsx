/**
 * The pieces every chat card is built from, ported from the desktop renderer:
 * the status card shell (`cards.rs`), its pressable header (`status_card_press_header`),
 * choice rows (`choice_rows.rs`), the question card buttons (`question_button` in `question.rs`)
 * and the small bordered chat button (`chat_button` in `composer.rs`).
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Glyph, type GlyphName } from './icons';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';

export const CARD_TEXT_SIZE = 14;
export const CARD_LINE_HEIGHT = 20;

/**
 * The status card: a rounded shell with a panel (header plus body) and an optional footer band
 * of actions, right-aligned and wrapping.
 */
export function StatusCard({
  header,
  body,
  actions,
  style,
}: {
  header: ReactNode;
  body?: ReactNode[];
  actions?: ReactNode[];
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const bodyItems = (body ?? []).filter((item) => item !== null && item !== undefined && item !== false);
  const actionItems = (actions ?? []).filter((item) => item !== null && item !== undefined && item !== false);
  const hasActions = actionItems.length > 0;
  return (
    <View style={[styles.card, { backgroundColor: hasActions ? P.cardFooter : P.cardPanel }, style]}>
      <View style={[styles.panel, hasActions && styles.panelWithFooter]}>
        {header}
        {bodyItems.length > 0 ? <View style={styles.body}>{bodyItems}</View> : null}
      </View>
      {hasActions ? <View style={styles.footer}>{actionItems}</View> : null}
    </View>
  );
}

/**
 * A card header: lead icon, title, optional trailing content and fold chevron. With `onPress`
 * the whole header is the fold's target and lights edge to edge when pressed, as the desktop
 * decision for status card headers asks.
 */
export function CardHeader({
  icon,
  iconColor,
  title,
  titleAddon,
  trailing,
  chevron,
  onPress,
  accessibilityLabel,
  hasBody,
}: {
  icon?: GlyphName;
  iconColor?: string;
  title: ReactNode;
  titleAddon?: ReactNode;
  trailing?: ReactNode;
  /** `open` / `closed` draws the fold chevron. */
  chevron?: 'open' | 'closed';
  onPress?: () => void;
  accessibilityLabel?: string;
  /** A body follows under a pressable header, so it keeps only a short gap below itself. */
  hasBody?: boolean;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const content = (
    <>
      {icon !== undefined ? (
        <View style={styles.headerIcon}>
          <Glyph name={icon} size={14} color={iconColor ?? P.muted} />
        </View>
      ) : null}
      <View style={styles.headerTitleRow}>
        {typeof title === 'string' ? (
          <Text style={styles.headerTitle} numberOfLines={titleAddon ? 1 : undefined}>
            {title}
          </Text>
        ) : (
          title
        )}
        {titleAddon}
      </View>
      {trailing}
      {chevron !== undefined ? (
        <View style={styles.headerIcon}>
          <Glyph name={chevron === 'open' ? 'chevron-down' : 'chevron-right'} size={14} color={P.muted} />
        </View>
      ) : null}
    </>
  );
  if (onPress === undefined) {
    return <View style={styles.header}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.header, styles.pressHeader, hasBody === true && styles.pressHeaderWithBody, pressed && { backgroundColor: P.pressedFill }]}
    >
      {content}
    </Pressable>
  );
}

/** One pickable row: label, optional description, a check when selected. */
export function ChoiceRow({
  label,
  description,
  selected,
  dense,
  disabled,
  onPress,
}: {
  label: string;
  description?: string;
  selected: boolean;
  dense?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const showDescription = description !== undefined && description.length > 0 && description !== label;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled: disabled === true }}
      disabled={disabled === true || onPress === undefined}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        dense && styles.choiceDense,
        // The light chat lifts a choice off the card onto the page tone (`choice_rows.rs`).
        P.light && !selected && { backgroundColor: P.background },
        selected && styles.choiceSelected,
        disabled === true && styles.disabledSoft,
        pressed && !selected && { backgroundColor: P.pressedFill },
      ]}
    >
      <View style={styles.choiceText}>
        <Text style={styles.choiceLabel}>{label}</Text>
        {showDescription ? <Text style={styles.choiceDescription}>{description}</Text> : null}
      </View>
      {selected ? <Glyph name="check" size={16} color={P.controlPrimary} /> : null}
    </Pressable>
  );
}

/** The question card's footer button (`question_button`): bordered, or ghost without a border. */
export function CardButton({
  label,
  onPress,
  disabled,
  ghost,
  wide,
  tint,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  ghost?: boolean;
  wide?: boolean;
  tint?: string;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled === true }}
      disabled={disabled === true}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.cardButton,
        ghost ? styles.cardButtonGhost : null,
        wide ? styles.cardButtonWide : null,
        disabled === true && styles.disabled,
        pressed && { backgroundColor: P.input },
      ]}
    >
      <Text style={[styles.cardButtonLabel, tint !== undefined && { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

/** The small bordered button the chat uses for Retry, Use, Dismiss and the dialog actions. */
export function ChatButton({
  label,
  onPress,
  icon,
  disabled,
}: {
  label: string;
  onPress: () => void;
  icon?: GlyphName;
  disabled?: boolean;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled === true}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.chatButton, disabled === true && styles.disabled, pressed && { backgroundColor: P.border }]}
    >
      {icon !== undefined ? <Glyph name={icon} size={14} color={P.primary} /> : null}
      <Text style={styles.chatButtonLabel}>{label}</Text>
    </Pressable>
  );
}

/** A turning ring (the loader glyph). */
export function Spinner({ size, color, periodMs = 1000 }: { size: number; color: string; periodMs?: number }) {
  const turn = useLoop(periodMs, Easing.linear);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ width: size, height: size, transform: [{ rotate }] }}>
      <Glyph name="loader" size={size} color={color} />
    </Animated.View>
  );
}

/** A dot whose opacity pulses (the fleet's working dot, the activity dot). */
export function PulseDot({ size, color, active }: { size: number; color: string; active: boolean }) {
  const phase = useLoop(1600, Easing.linear, active);
  const opacity = active
    ? phase.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.35, 1] })
    : 1;
  return <Animated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity }} />;
}

/** A 0 to 1 value that loops forever while `running`. */
export function useLoop(periodMs: number, easing: (value: number) => number, running = true): Animated.Value {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!running) {
      value.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.timing(value, { toValue: 1, duration: periodMs, easing, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [easing, periodMs, running, value]);
  return value;
}

const useStyles = themedStyles((P) => ({
  card: {
    width: '100%',
    borderWidth: 1,
    borderColor: P.inputBorder,
    borderRadius: 12,
    overflow: 'hidden',
  },
  panel: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: P.cardPanel,
  },
  panelWithFooter: {
    borderTopLeftRadius: 11,
    borderTopRightRadius: 11,
  },
  body: {
    paddingTop: 8,
    gap: 12,
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: P.light ? P.border : 'rgba(255,255,255,0.04)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  pressHeader: {
    marginHorizontal: -16,
    marginTop: -12,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    marginBottom: -12,
    borderRadius: 11,
  },
  pressHeaderWithBody: {
    paddingBottom: 6,
    marginBottom: -2,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  headerIcon: {
    height: CARD_LINE_HEIGHT,
    justifyContent: 'center',
  },
  headerTitleRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: P.foreground,
    fontSize: CARD_TEXT_SIZE,
    lineHeight: CARD_LINE_HEIGHT,
    fontWeight: '500',
    flexShrink: 0,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: P.controlBorder,
  },
  choiceDense: {
    paddingVertical: 7,
  },
  choiceSelected: {
    backgroundColor: P.selectedFill,
    borderColor: P.selectedBorder,
  },
  choiceText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  choiceLabel: {
    color: P.foreground,
    fontSize: CARD_TEXT_SIZE,
    lineHeight: 19,
  },
  choiceDescription: {
    color: P.cardMuted,
    fontSize: CARD_TEXT_SIZE,
    lineHeight: 19,
  },
  cardButton: {
    minHeight: 32,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: P.controlBorder,
  },
  cardButtonGhost: {
    borderColor: 'transparent',
  },
  cardButtonWide: {
    minWidth: 96,
  },
  cardButtonLabel: {
    color: P.foreground,
    fontSize: CARD_TEXT_SIZE,
  },
  chatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: P.border,
  },
  chatButtonLabel: {
    color: P.primary,
    fontSize: CARD_TEXT_SIZE,
  },
  disabled: {
    opacity: 0.5,
  },
  disabledSoft: {
    opacity: 0.6,
  },
}));

export const useCardText = themedStyles((P) => ({
  prose: {
    color: P.cardMuted,
    fontSize: CARD_TEXT_SIZE,
    lineHeight: CARD_LINE_HEIGHT,
  },
  hint: {
    color: P.cardMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  muted: {
    color: P.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  mono: {
    color: P.cardMuted,
    fontFamily: 'Menlo',
    fontSize: 12,
    lineHeight: 17,
  },
  error: {
    color: P.error,
    fontSize: CARD_TEXT_SIZE,
    lineHeight: CARD_LINE_HEIGHT,
  },
}));

const useWellSheet = themedStyles((P) => ({
  well: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: P.wellBorder,
    backgroundColor: P.wellFill,
  },
}));

/** The inset well a command or a terminal excerpt sits in. */
export function useWellStyle(): ViewStyle {
  return useWellSheet().well;
}
