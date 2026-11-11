/**
 * A coordinator's fold control, beside its hat: the chevron that folds or unfolds its threads, pointing right while
 * they are folded. The project list's SessionRow and the Unified list's card, slim row and wall tile all draw this one
 * control (CDXC:Sidebar 2026-11-11 in packages/gx-core/src/unified_sidebar/tree.rs). The desktop swaps its hat for the
 * chevron on hover (decorations.rs); a phone has no hover, so the chevron sits beside the hat.
 *
 * It is its own Pressable, so a tap folds and never reaches the row or card under it.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { SidebarPalette } from '../../theme/palette';
import { ChevronRightGlyph, CoordinatorGlyph, CrownGlyph } from './icons';
import { ds, useSidebarInk } from './rows';

export function CoordinatorFold({
  collapsed,
  onToggle,
  hat,
  style,
}: {
  collapsed: boolean;
  onToggle: () => void;
  /**
   * The hat drawn before the chevron, inside the same button, so a tap anywhere on the hat folds too (a Unified card
   * and slim row). SessionRow leaves it out: its icon slot draws the hat, or a clock that keeps its own meaning.
   */
  hat?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const ink = useSidebarInk();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={collapsed ? 'Show threads' : 'Hide threads'}
      accessibilityState={{ expanded: !collapsed }}
      hitSlop={ds(10)}
      onPress={onToggle}
      style={[hat === undefined ? styles.chevron : styles.withHat, style]}
    >
      {hat}
      <View style={styles.chevron}>
        <ChevronRightGlyph size={ds(14)} color={ink.light ? ink.muted : SidebarPalette.MUTED} rotated={!collapsed} />
      </View>
    </Pressable>
  );
}

/**
 * A coordinator's hat (a Chief of Staff's crown), or the hollow ring while a fold hides the open thread under it
 * (gx-core `RowNesting::contains_active_session`), at 15dp like SessionRow's icon slot.
 */
export function CoordinatorHat({ chief, containsActive }: { chief: boolean; containsActive: boolean }) {
  const ink = useSidebarInk();
  return (
    <View style={styles.hat}>
      {containsActive ? (
        <View style={[styles.ring, { borderColor: ink.activeRing }]} />
      ) : chief ? (
        <CrownGlyph size={ds(13)} color={ink.crown} />
      ) : (
        <CoordinatorGlyph size={ds(15)} color={ink.crown} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chevron: {
    width: ds(14),
    height: ds(14),
    alignItems: 'center',
    justifyContent: 'center',
  },
  withHat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ds(6),
  },
  hat: {
    width: ds(15),
    height: ds(15),
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    width: ds(9),
    height: ds(9),
    borderRadius: 999,
    borderWidth: ds(1.5),
  },
});
