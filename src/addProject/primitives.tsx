/**
 * Shared Add Project screen primitives rendered with the
 * Ghostex mobile design tokens: card /
 * row / input radii from GhostexRadii, GhostexPalette surfaces, 1dp strokes.
 */

import type { ReactElement, ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import KeyboardAwareScrollView from '../components/common/keyboard/KeyboardAwareScrollView';
import { CaretRightGlyph } from '../components/sessions/icons';
import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../theme/palette';

const MONOSPACE = Platform.select({ ios: 'Menlo', default: 'monospace' });

export function AddProjectShell({ children }: { children: ReactNode }): ReactElement {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {children}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

export function SectionTitle({ children }: { children: string }): ReactElement {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function MutedText({ children }: { children: string }): ReactElement {
  return <Text style={styles.mutedText}>{children}</Text>;
}

export function ListSection({ children }: { children: ReactNode }): ReactElement {
  return <View style={styles.listSection}>{children}</View>;
}

export function ListRow({
  description,
  disabled,
  first,
  icon,
  onPress,
  testID,
  title,
  trailing,
}: {
  description?: string | null;
  disabled?: boolean;
  first?: boolean;
  icon?: ReactNode;
  onPress: () => void;
  testID?: string;
  title: string;
  trailing?: ReactNode;
}): ReactElement {
  const isDisabled = disabled === true;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      accessibilityLabel={title}
      testID={testID}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.listRow,
        first !== true && styles.listRowDivided,
        isDisabled && styles.listRowDisabled,
        pressed && !isDisabled && styles.listRowPressed,
      ]}
    >
      {icon === undefined ? null : <View style={styles.listRowIcon}>{icon}</View>}
      <View style={styles.listRowBody}>
        <Text numberOfLines={1} style={styles.listRowTitle}>
          {title}
        </Text>
        {description === undefined || description === null || description.length === 0 ? null : (
          <Text numberOfLines={2} style={styles.listRowDescription}>
            {description}
          </Text>
        )}
      </View>
      {trailing !== undefined ? (
        trailing
      ) : isDisabled ? null : (
        <CaretRightGlyph size={14} color={GhostexPalette.MUTED} />
      )}
    </Pressable>
  );
}

export function SetupRequiredBadge({ label }: { label: string }): ReactElement {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeLabel}>{label}</Text>
    </View>
  );
}

export function PrimaryActionButton({
  disabled,
  label,
  loading,
  onPress,
  testID,
}: {
  disabled?: boolean;
  label: string;
  loading?: boolean;
  onPress: () => void;
  testID?: string;
}): ReactElement {
  const isDisabled = disabled === true || loading === true;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading === true }}
      testID={testID}
      disabled={isDisabled}
      onPress={onPress}
      style={[styles.primaryButton, isDisabled && styles.primaryButtonDisabled]}
    >
      {loading === true ? (
        <ActivityIndicator size="small" color={GhostexPalette.ACCENT_FOREGROUND} />
      ) : (
        <Text style={styles.primaryButtonLabel}>{label}</Text>
      )}
    </Pressable>
  );
}

export function ProjectPathInput({
  onChangeText,
  onSubmitEditing,
  placeholder,
  testID,
  value,
}: {
  onChangeText: (value: string) => void;
  onSubmitEditing?: () => void;
  placeholder: string;
  testID?: string;
  value: string;
}): ReactElement {
  return (
    <TextInput
      style={styles.pathInput}
      testID={testID}
      value={value}
      onChangeText={onChangeText}
      onSubmitEditing={onSubmitEditing}
      placeholder={placeholder}
      placeholderTextColor={GhostexPalette.MUTED}
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      returnKeyType="done"
      submitBehavior="blurAndSubmit"
    />
  );
}

/** Inline rose-tinted failure banner — mobile never uses toasts (spec §5.2). */
export function ErrorBanner({ message }: { message: string }): ReactElement {
  return (
    <View accessibilityRole="alert" style={styles.errorBanner}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

export function PendingRow({ label }: { label: string }): ReactElement {
  return (
    <View style={styles.pendingRow}>
      <ActivityIndicator size="small" color={GhostexPalette.ACCENT} />
      <Text style={styles.pendingLabel}>{label}</Text>
    </View>
  );
}

/** Repository context card pinned above the destination browser (spec §5.7). */
export function RepositoryCard({
  subtitle,
  title,
}: {
  subtitle: string;
  title: string;
}): ReactElement {
  return (
    <View style={styles.repositoryCard}>
      <Text numberOfLines={1} style={styles.repositoryTitle}>
        {title}
      </Text>
      <Text numberOfLines={2} style={styles.repositorySubtitle}>
        {subtitle}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GhostexPalette.BACKGROUND,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    gap: 10,
  },
  sectionTitle: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 12,
  },
  mutedText: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    lineHeight: 17,
  },
  listSection: {
    overflow: 'hidden',
    borderRadius: GhostexRadii.card,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    backgroundColor: GhostexPalette.CARD,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 52,
  },
  listRowDivided: {
    borderTopWidth: GhostexStrokeWidth,
    borderTopColor: GhostexPalette.BORDER,
  },
  listRowDisabled: {
    opacity: 0.45,
  },
  listRowPressed: {
    backgroundColor: GhostexPalette.CARD_ACTIVE,
  },
  listRowIcon: {
    width: 28,
    height: 28,
    borderRadius: GhostexRadii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GhostexPalette.CARD_ACTIVE,
  },
  listRowBody: {
    flex: 1,
    gap: 2,
  },
  listRowTitle: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 15,
    fontWeight: '600',
  },
  listRowDescription: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    lineHeight: 16,
  },
  badge: {
    borderRadius: GhostexRadii.pill,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.STATUS_WORKING,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeLabel: {
    color: GhostexPalette.STATUS_WORKING,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  primaryButton: {
    height: 48,
    borderRadius: GhostexRadii.card,
    backgroundColor: GhostexPalette.ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.45,
  },
  primaryButtonLabel: {
    color: GhostexPalette.ACCENT_FOREGROUND,
    fontSize: 15,
    fontWeight: '700',
  },
  pathInput: {
    backgroundColor: GhostexPalette.INPUT_BACKGROUND,
    borderRadius: GhostexRadii.input,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    color: GhostexPalette.FOREGROUND,
    paddingHorizontal: 12,
    height: 48,
    fontSize: 14,
    fontFamily: MONOSPACE,
  },
  errorBanner: {
    borderRadius: GhostexRadii.card,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.DANGER,
    backgroundColor: 'rgba(232,92,92,0.08)',
    padding: 12,
  },
  errorText: {
    color: GhostexPalette.DANGER,
    fontSize: 13,
    lineHeight: 18,
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  pendingLabel: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    flex: 1,
  },
  repositoryCard: {
    borderRadius: GhostexRadii.card,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    backgroundColor: GhostexPalette.CARD,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  repositoryTitle: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 15,
    fontWeight: '600',
  },
  repositorySubtitle: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    lineHeight: 16,
  },
});
