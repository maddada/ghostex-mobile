/**
 * The merged model picker the model pill opens (`option_menu/model_menu/`): agent tabs, search,
 * the model rows with their favorite stars, and the trait buttons (reasoning, context window, fast
 * mode) with their choice lists. Every gesture is the action desktop sends: `modelMenuView`,
 * `modelMenuPick`, `modelMenuFavorite`, `modelMenuTrait`. A tap picks with the default scope; a
 * long press is desktop's right-click (`secondary`, this session only).
 */

import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AGENT_ICONS } from '../../../assets/agentIcons.generated';
import type { UserAction } from '../../rust/actions';
import { agentAccent } from './agentColors';
import { Glyph, type GlyphName } from './icons';
import { arr, isTrue, obj, str, type JsonRecord } from './json';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { Sheet } from './Sheet';

const TRAIT_GLYPHS: Record<string, GlyphName> = { reasoning: 'brain', context: 'file-text', fast: 'bolt', plan: 'map' };

export function ModelMenuSheet({
  menu,
  visible,
  onClose,
  dispatch,
}: {
  menu: JsonRecord | null;
  visible: boolean;
  onClose: () => void;
  dispatch: (action: UserAction) => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const [query, setQuery] = useState('');
  const [openTrait, setOpenTrait] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    // Every visit starts on the session's own agent with an empty search (state.rs).
    setQuery('');
    setOpenTrait(null);
    dispatch({ type: 'modelMenuView', tab: null as unknown as string, query: '' });
  }, [visible, dispatch]);

  const disabled = isTrue(menu, 'disabled');
  const sessionScope = isTrue(menu, 'sessionScope');
  const rows = arr(menu?.rows);
  const traits = arr(menu?.traits);
  const trait = openTrait !== null ? traits.find((entry) => str(entry, 'id') === openTrait) : undefined;
  const error = str(menu, 'error');
  const emptyText = str(menu, 'emptyText');

  const pick = (key: unknown, secondary: boolean): void => {
    if (disabled || typeof key !== 'string') return;
    dispatch({ type: 'modelMenuPick', key, secondary });
    onClose();
  };

  return (
    <Sheet
      visible={visible && menu !== null}
      onClose={onClose}
      title={trait !== undefined ? str(trait, 'label') : 'Model'}
      {...(trait !== undefined ? { onBack: () => setOpenTrait(null) } : {})}
      maxHeight="85%"
    >
      {trait !== undefined ? (
        <ScrollView contentContainerStyle={styles.list}>
          {arr(obj(trait)?.choices).map((choice, index) => (
            <Pressable
              key={`${index}:${String(obj(choice)?.value)}`}
              accessibilityRole="menuitem"
              accessibilityState={{ checked: isTrue(choice, 'selected') }}
              onPress={() => {
                dispatch({
                  type: 'modelMenuTrait',
                  id: str(trait, 'id'),
                  value: (obj(choice)?.value ?? null) as never,
                  exitPlan: obj(choice)?.exitPlan === true,
                  secondary: false,
                });
                setOpenTrait(null);
              }}
              onLongPress={
                sessionScope
                  ? () => {
                      dispatch({
                        type: 'modelMenuTrait',
                        id: str(trait, 'id'),
                        value: (obj(choice)?.value ?? null) as never,
                        exitPlan: obj(choice)?.exitPlan === true,
                        secondary: true,
                      });
                      setOpenTrait(null);
                    }
                  : undefined
              }
              style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
            >
              <Text style={styles.rowLabel}>
                {str(choice, 'label')}
                {isTrue(choice, 'isDefault') ? <Text style={styles.muted}>  Default</Text> : null}
              </Text>
              {isTrue(choice, 'selected') ? <Glyph name="check" size={17} color={P.foreground} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {arr(menu?.tabs).map((tab) => {
              const id = str(tab, 'id');
              const active = isTrue(tab, 'active');
              const icon = str(tab, 'icon');
              const Icon = icon.length > 0 ? AGENT_ICONS[icon] : undefined;
              return (
                <Pressable
                  key={id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={str(tab, 'name')}
                  onPress={() => dispatch({ type: 'modelMenuView', tab: id })}
                  style={[styles.tab, active ? styles.tabActive : null]}
                >
                  {id === 'favorites' ? (
                    <Glyph name="star" size={15} color={active ? P.foreground : P.muted} />
                  ) : Icon !== undefined ? (
                    <Icon size={15} color={agentAccent(icon, P.light)} />
                  ) : null}
                  <Text style={[styles.tabText, active ? styles.tabTextActive : null]}>{str(tab, 'name')}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.search}>
            <Glyph name="search" size={16} color={P.muted} />
            <TextInput
              value={query}
              onChangeText={(next) => {
                setQuery(next);
                dispatch({ type: 'modelMenuView', query: next });
              }}
              placeholder={str(menu, 'placeholder') || 'Search models'}
              placeholderTextColor={P.placeholder}
              style={styles.searchInput}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
            {error.length > 0 ? <Text style={styles.error}>{error}</Text> : null}
            {rows.length === 0 && emptyText.length > 0 ? <Text style={styles.empty}>{emptyText}</Text> : null}
            {rows.map((row) => {
              const key = str(row, 'key');
              const icon = str(row, 'icon');
              const Icon = isTrue(row, 'showAgent') && icon.length > 0 ? AGENT_ICONS[icon] : undefined;
              const description = str(row, 'description');
              const favorite = isTrue(row, 'favorite');
              return (
                <Pressable
                  key={key}
                  accessibilityRole="menuitem"
                  accessibilityState={{ checked: isTrue(row, 'selected'), disabled }}
                  disabled={disabled}
                  onPress={() => pick(key, false)}
                  onLongPress={sessionScope ? () => pick(key, true) : undefined}
                  style={({ pressed }) => [styles.row, pressed ? styles.pressed : null, disabled ? styles.dim : null]}
                >
                  {Icon !== undefined ? <Icon size={17} color={agentAccent(icon, P.light)} /> : null}
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel} numberOfLines={1}>
                      {str(row, 'label')}
                    </Text>
                    {description.length > 0 ? (
                      <Text style={styles.description} numberOfLines={2}>
                        {description}
                      </Text>
                    ) : null}
                  </View>
                  {isTrue(row, 'selected') ? <Glyph name="check" size={17} color={P.foreground} /> : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={favorite ? 'Remove from favorites' : 'Add to favorites'}
                    hitSlop={8}
                    onPress={() => dispatch({ type: 'modelMenuFavorite', key })}
                    style={styles.star}
                  >
                    <Glyph name={favorite ? 'star-filled' : 'star'} size={17} color={favorite ? P.star : P.muted} />
                  </Pressable>
                </Pressable>
              );
            })}
          </ScrollView>
          {traits.length > 0 ? (
            <View style={styles.traits}>
              {traits.map((entry) => {
                const id = str(entry, 'id');
                const traitDisabled = disabled || isTrue(entry, 'disabled');
                const toggle = obj(obj(entry)?.toggle);
                const glyph = TRAIT_GLYPHS[str(entry, 'icon')] ?? 'adjustments-horizontal';
                return (
                  <Pressable
                    key={id}
                    accessibilityRole="button"
                    accessibilityLabel={`${str(entry, 'label')}: ${str(entry, 'valueLabel')}`}
                    disabled={traitDisabled}
                    onPress={() => {
                      if (toggle !== null) {
                        dispatch({
                          type: 'modelMenuTrait',
                          id,
                          value: (toggle.value ?? null) as never,
                          exitPlan: toggle.exitPlan === true,
                          secondary: false,
                        });
                      } else {
                        setOpenTrait(id);
                      }
                    }}
                    style={({ pressed }) => [styles.trait, pressed ? styles.pressed : null, traitDisabled ? styles.dim : null]}
                  >
                    <Glyph name={glyph} size={16} color={P.primary} />
                    <View style={styles.rowText}>
                      <Text style={styles.traitLabel} numberOfLines={1}>
                        {str(entry, 'label')}
                      </Text>
                      <Text style={styles.traitValue} numberOfLines={1}>
                        {str(entry, 'valueLabel')}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </>
      )}
    </Sheet>
  );
}

const useStyles = themedStyles((P) => ({
  tabs: { paddingHorizontal: 12, gap: 6, paddingBottom: 8 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: P.menuBorder },
  tabActive: { backgroundColor: P.border, borderColor: P.ink(0.18) },
  tabText: { color: P.muted, fontSize: 13 },
  tabTextActive: { color: P.foreground },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 6,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 10,
    backgroundColor: P.composerBackground,
    borderWidth: 1,
    borderColor: P.composerBorder,
  },
  searchInput: { flex: 1, color: P.foreground, fontSize: 15, paddingVertical: 0 },
  list: { paddingHorizontal: 8, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  pressed: { backgroundColor: P.controlPressed },
  dim: { opacity: 0.45 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowLabel: { color: P.foreground, fontSize: 15 },
  description: { color: P.muted, fontSize: 12.5, lineHeight: 17 },
  muted: { color: P.muted, fontSize: 13 },
  star: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  error: { color: P.error, fontSize: 13, paddingHorizontal: 12, paddingVertical: 6 },
  empty: { color: P.muted, fontSize: 14, paddingHorizontal: 12, paddingVertical: 12 },
  traits: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: P.menuBorder,
  },
  trait: {
    flexGrow: 1,
    flexBasis: '30%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: P.menuBorder,
  },
  traitLabel: { color: P.muted, fontSize: 11.5 },
  traitValue: { color: P.foreground, fontSize: 14 },
}));
