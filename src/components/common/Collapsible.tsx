/**
 * The collapsible sections of the app (`.advanced` in
 * docs/2026-09-03/mobile-setup/shared.css): a header with a title, a muted
 * hint of what is inside and a chevron that turns as it opens; the body is
 * only mounted while open. `Collapsible` is one standalone card (both Advanced
 * sections of the machine form); `Accordion` stacks several `row` variants
 * inside one panel and keeps at most one of them open (the "Other reasons"
 * list on Can't reach). Their look can only ever change here.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { GhostexRadii, GhostexStrokeWidth, SetupPalette } from '../../theme/palette';

const CHEVRON_TURN_MS = 160;

export type CollapsibleProps = {
  title: string;
  /** Short list of what the body holds, shown while collapsed and expanded. */
  hint?: string;
  initiallyOpen?: boolean;
  /**
   * Controlled open state (an accordion owns it); when omitted the section
   * keeps its own, starting from `initiallyOpen`.
   */
  open?: boolean;
  onToggle?: () => void;
  /**
   * `card`: a bordered panel of its own. `row`: borderless, for stacking
   * inside a panel that draws the outer edge; rows after the first draw a
   * hairline above themselves.
   */
  variant?: 'card' | 'row';
  /** `row` only: the header title colour (a highlighted row uses the foreground). */
  titleColor?: string;
  children: ReactNode;
};

function Chevron({ open }: { open: boolean }) {
  const turn = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(turn, {
      toValue: open ? 1 : 0,
      duration: CHEVRON_TURN_MS,
      useNativeDriver: true,
    }).start();
  }, [open, turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Svg
        width={16}
        height={16}
        viewBox="0 0 24 24"
        fill="none"
        stroke={SetupPalette.MUTED}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <Path d="M9 6l6 6l-6 6" />
      </Svg>
    </Animated.View>
  );
}

export default function Collapsible({
  title,
  hint,
  initiallyOpen = false,
  open: controlledOpen,
  onToggle,
  variant = 'card',
  titleColor,
  children,
}: CollapsibleProps) {
  const [ownOpen, setOwnOpen] = useState(initiallyOpen);
  const open = controlledOpen ?? ownOpen;
  const toggle = (): void => {
    if (onToggle !== undefined) onToggle();
    else setOwnOpen((current) => !current);
  };
  return (
    <View style={variant === 'card' ? styles.card : null}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.header, pressed ? styles.headerPressed : null]}
        onPress={toggle}
      >
        <View style={styles.headerText}>
          <Text style={[styles.title, titleColor !== undefined ? { color: titleColor } : null]}>{title}</Text>
          {hint !== undefined && hint.length > 0 ? <Text style={styles.hint}>{hint}</Text> : null}
        </View>
        <Chevron open={open} />
      </Pressable>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

export type AccordionItem = {
  id: string;
  title: string;
  hint?: string;
  titleColor?: string;
  body: ReactNode;
};

/**
 * Several `row` collapsibles in one panel, at most one open at a time.
 * `initiallyOpenId` opens one on mount (the reason that matches the current
 * error); tapping the open row closes it.
 */
export function Accordion({
  items,
  initiallyOpenId = null,
}: {
  items: readonly AccordionItem[];
  initiallyOpenId?: string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(initiallyOpenId);
  return (
    <View style={styles.accordion}>
      {items.map((item, index) => (
        <View key={item.id} style={index > 0 ? styles.accordionRowDivided : null}>
          <Collapsible
            variant="row"
            title={item.title}
            hint={item.hint}
            titleColor={item.titleColor}
            open={openId === item.id}
            onToggle={() => setOpenId((current) => (current === item.id ? null : item.id))}
          >
            {item.body}
          </Collapsible>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: GhostexRadii.section,
    borderWidth: GhostexStrokeWidth,
    borderColor: SetupPalette.BORDER,
    backgroundColor: SetupPalette.PANEL,
    overflow: 'hidden',
  },
  accordion: {
    borderRadius: GhostexRadii.section,
    borderWidth: GhostexStrokeWidth,
    borderColor: SetupPalette.BORDER,
    backgroundColor: SetupPalette.PANEL,
    overflow: 'hidden',
  },
  accordionRowDivided: {
    borderTopWidth: GhostexStrokeWidth,
    borderTopColor: SetupPalette.BORDER,
  },
  header: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerPressed: {
    backgroundColor: SetupPalette.CARD_HOVER,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: SetupPalette.FOREGROUND,
    fontSize: 14,
    fontWeight: '600',
  },
  hint: {
    color: SetupPalette.DIM,
    fontSize: 12,
  },
  body: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 2,
    gap: 12,
    borderTopWidth: GhostexStrokeWidth,
    borderTopColor: SetupPalette.BORDER,
  },
});
