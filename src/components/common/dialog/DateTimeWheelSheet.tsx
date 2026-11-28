/**
 * The app's own date and time picker: a dialog sheet with a row of quick picks that scrolls sideways and three
 * wheels (day, hour, minute), then Set and Cancel. Delayed Send's "At a specific time" uses it on both phones.
 *
 * CDXC:PhoneDialogs 2026-11-28 DECISION:
 * User, picking from the picker page: one sheet with three wheels (not a month calendar), quick picks above them
 * ("make the quick picks show as pills that i can scroll sideways"), and ours on iOS too instead of the system
 * wheel, so Delayed Send looks the same on both phones. Minutes step by 5; a time in the past snaps to the next
 * free 5 minutes, and nothing past `max` can be picked.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';
import * as Haptics from 'expo-haptics';

import { useAppearance, type Appearance } from '../../../theme/useAppearance';
import { GhostexRadii } from '../../../theme/palette';
import DialogSheet from './DialogSheet';
import { DialogButton, DialogButtons, DialogMessage, DialogTitle } from './DialogParts';

const ROW = 40;
const VISIBLE_ROWS = 5;
const MINUTE_STEP = 5;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export type DateTimeWheelSheetProps = {
  visible: boolean;
  title: string;
  value: Date;
  /** The earliest moment that can be picked (now); earlier picks snap to the next free step. */
  min: Date;
  max: Date;
  onSet: (value: Date) => void;
  onCancel: () => void;
  /** Drawn inside the Modal that is already open (Delayed Send's own dialog). */
  inline?: boolean;
};

/** Whether this phone's locale writes the time with a 24-hour clock. */
function uses24HourClock(): boolean {
  return !/[ap]\.?\s?m/iu.test(new Date(2020, 0, 1, 13, 0).toLocaleTimeString([], { hour: 'numeric' }));
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** The next whole step at or after `date`. */
function ceilToStep(date: Date): Date {
  const step = MINUTE_STEP * MINUTE_MS;
  return new Date(Math.ceil(date.getTime() / step) * step);
}

function floorToStep(date: Date): Date {
  const step = MINUTE_STEP * MINUTE_MS;
  return new Date(Math.floor(date.getTime() / step) * step);
}

function clampToRange(date: Date, min: Date, max: Date): Date {
  const first = ceilToStep(new Date(min.getTime() + MINUTE_MS));
  const last = floorToStep(max);
  if (date.getTime() < first.getTime()) return first;
  if (date.getTime() > last.getTime()) return last;
  return date;
}

function dayLabel(day: Date, today: Date): string {
  const offset = Math.round((startOfDay(day).getTime() - today.getTime()) / DAY_MS);
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  return day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function clockLabel(date: Date, hour24: boolean): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: !hour24 });
}

function inLabel(target: Date, now: Date): string {
  const minutes = Math.max(1, Math.round((target.getTime() - now.getTime()) / MINUTE_MS));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `in ${rest} min`;
  if (rest === 0) return `in ${hours} h`;
  return `in ${hours} h ${rest} min`;
}

export default function DateTimeWheelSheet({
  visible,
  title,
  value,
  min,
  max,
  onSet,
  onCancel,
  inline = false,
}: DateTimeWheelSheetProps) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const hour24 = useMemo(uses24HourClock, []);
  const [draft, setDraft] = useState(() => clampToRange(ceilToStep(value), min, max));
  // Seeded from `value` each time the sheet opens.
  useEffect(() => {
    if (visible) setDraft(clampToRange(ceilToStep(value), min, max));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const today = startOfDay(min);
  const days = useMemo(() => {
    const list: Date[] = [];
    // A day and a half on, then back to that day's start: steps one calendar day across a clock change.
    for (let day = startOfDay(min); day.getTime() <= max.getTime(); day = startOfDay(new Date(day.getTime() + DAY_MS * 1.5))) {
      list.push(day);
    }
    return list;
  }, [min, max]);
  const dayIndex = Math.max(0, days.findIndex((day) => day.getTime() === startOfDay(draft).getTime()));
  const hourIndex = draft.getHours();
  const minuteIndex = Math.floor(draft.getMinutes() / MINUTE_STEP);

  const pick = (day: Date, hour: number, minute: number): void => {
    setDraft(clampToRange(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute), min, max));
  };

  const quickPicks = useMemo(() => {
    const now = min;
    const picks: { label: string; at: Date }[] = [
      { label: 'In 30 min', at: ceilToStep(new Date(now.getTime() + 30 * MINUTE_MS)) },
      { label: 'In 1 hour', at: ceilToStep(new Date(now.getTime() + 60 * MINUTE_MS)) },
      { label: 'In 3 hours', at: ceilToStep(new Date(now.getTime() + 180 * MINUTE_MS)) },
    ];
    const tonight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0);
    if (tonight.getTime() - now.getTime() > 30 * MINUTE_MS) {
      picks.push({ label: `Tonight ${clockLabel(tonight, hour24)}`, at: tonight });
    }
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0);
    picks.push({ label: `Tomorrow ${clockLabel(tomorrow, hour24)}`, at: tomorrow });
    const nextWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 9, 0);
    picks.push({
      label: `Next ${nextWeek.toLocaleDateString(undefined, { weekday: 'short' })} ${clockLabel(nextWeek, hour24)}`,
      at: nextWeek,
    });
    return picks.filter((entry) => entry.at.getTime() <= max.getTime());
  }, [min, max, hour24]);

  const summary = `${dayLabel(draft, today)} at ${clockLabel(draft, hour24)}, ${inLabel(draft, min)}`;
  const hourLabels = useMemo(
    () =>
      Array.from({ length: 24 }, (_, hour) =>
        hour24 ? String(hour).padStart(2, '0') : `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'AM' : 'PM'}`,
      ),
    [hour24],
  );
  const minuteLabels = useMemo(
    () => Array.from({ length: 60 / MINUTE_STEP }, (_, index) => String(index * MINUTE_STEP).padStart(2, '0')),
    [],
  );

  return (
    <DialogSheet visible={visible} inline={inline} onDismiss={onCancel} accessibilityLabel={title}>
      <DialogTitle>{title}</DialogTitle>
      <DialogMessage>{summary}</DialogMessage>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.picks}
        contentContainerStyle={styles.picksContent}
        keyboardShouldPersistTaps="handled"
      >
        {quickPicks.map((entry) => {
          const on = entry.at.getTime() === draft.getTime();
          return (
            <Pressable
              key={entry.label}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => setDraft(clampToRange(entry.at, min, max))}
              style={({ pressed }) => [styles.pill, on && styles.pillOn, pressed && styles.pillPressed]}
            >
              <Text style={[styles.pillLabel, on && styles.pillLabelOn]} numberOfLines={1}>
                {entry.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.wheels}>
        <View pointerEvents="none" style={styles.band} />
        <Wheel
          label="Day"
          flex={2.2}
          labels={days.map((day) => dayLabel(day, today))}
          index={dayIndex}
          onPick={(index) => pick(days[index] ?? days[0], hourIndex, minuteIndex * MINUTE_STEP)}
          styles={styles}
        />
        <Wheel
          label="Hour"
          flex={1}
          labels={hourLabels}
          index={hourIndex}
          onPick={(index) => pick(days[dayIndex] ?? days[0], index, minuteIndex * MINUTE_STEP)}
          styles={styles}
        />
        <Wheel
          label="Minute"
          flex={1}
          labels={minuteLabels}
          index={minuteIndex}
          onPick={(index) => pick(days[dayIndex] ?? days[0], hourIndex, index * MINUTE_STEP)}
          styles={styles}
        />
      </View>
      <DialogButtons>
        <DialogButton label="Set" kind="primary" onPress={() => onSet(draft)} />
        <DialogButton label="Cancel" kind="neutral" onPress={onCancel} />
      </DialogButtons>
    </DialogSheet>
  );
}

type WheelStyles = ReturnType<typeof createStyles>;

/**
 * One wheel: a list that snaps to rows, the picked one in the band at its middle. It settles on the row nearest
 * where a fling stops; a tap on a row picks it. Screen readers get one adjustable control per wheel.
 */
function Wheel({
  label,
  flex,
  labels,
  index,
  onPick,
  styles,
}: {
  label: string;
  flex: number;
  labels: readonly string[];
  index: number;
  onPick: (index: number) => void;
  styles: WheelStyles;
}) {
  const ref = useRef<ScrollViewInstance>(null);
  const [live, setLive] = useState(index);
  const liveRef = useRef(index);
  const scrolling = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clamp = (value: number): number => Math.max(0, Math.min(labels.length - 1, value));

  // Follows a pick made elsewhere (a quick pick, a snap back from the past) unless the finger is on this wheel.
  useEffect(() => {
    if (scrolling.current) return;
    ref.current?.scrollTo({ y: index * ROW, animated: true });
    liveRef.current = index;
    setLive(index);
  }, [index]);
  useEffect(
    () => () => {
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    },
    [],
  );

  const settle = (y: number): void => {
    scrolling.current = false;
    const next = clamp(Math.round(y / ROW));
    if (next !== index) onPick(next);
    else ref.current?.scrollTo({ y: next * ROW, animated: true });
  };
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const next = clamp(Math.round(event.nativeEvent.contentOffset.y / ROW));
    if (next === liveRef.current) return;
    liveRef.current = next;
    setLive(next);
    void Haptics.selectionAsync().catch(() => undefined);
  };

  return (
    <View
      style={[styles.wheel, { flex }]}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: labels[index] ?? '' }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        const next = clamp(index + (event.nativeEvent.actionName === 'increment' ? 1 : -1));
        if (next !== index) onPick(next);
      }}
    >
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ROW}
        decelerationRate="fast"
        scrollEventThrottle={16}
        nestedScrollEnabled
        contentContainerStyle={styles.wheelContent}
        onLayout={() => ref.current?.scrollTo({ y: index * ROW, animated: false })}
        onScroll={onScroll}
        onScrollBeginDrag={() => {
          scrolling.current = true;
          if (settleTimer.current !== null) clearTimeout(settleTimer.current);
        }}
        onScrollEndDrag={(event) => {
          const y = event.nativeEvent.contentOffset.y;
          settleTimer.current = setTimeout(() => settle(y), 90);
        }}
        onMomentumScrollBegin={() => {
          if (settleTimer.current !== null) clearTimeout(settleTimer.current);
        }}
        onMomentumScrollEnd={(event) => settle(event.nativeEvent.contentOffset.y)}
      >
        {labels.map((text, row) => {
          const distance = Math.abs(row - live);
          return (
            <Pressable key={text + row} style={styles.wheelRow} onPress={() => onPick(row)}>
              <Text
                numberOfLines={1}
                style={[
                  styles.wheelLabel,
                  distance === 0 ? styles.wheelLabelOn : { opacity: distance === 1 ? 0.6 : 0.3 },
                ]}
              >
                {text}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const createStyles = (appearance: Appearance) =>
  StyleSheet.create({
    picks: { flexGrow: 0, marginTop: 14, marginHorizontal: -16 },
    picksContent: { gap: 6, paddingHorizontal: 16 },
    pill: {
      height: 34,
      paddingHorizontal: 13,
      borderRadius: GhostexRadii.pill,
      backgroundColor: appearance.neutralFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pillOn: { backgroundColor: appearance.primaryFill },
    pillPressed: { backgroundColor: appearance.neutralFillPressed },
    pillLabel: { color: appearance.muted, fontSize: 13.5, fontWeight: '600' },
    pillLabelOn: { color: appearance.foreground },
    wheels: { flexDirection: 'row', gap: 4, height: ROW * VISIBLE_ROWS, marginTop: 12 },
    band: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: ROW * Math.floor(VISIBLE_ROWS / 2),
      height: ROW,
      borderRadius: GhostexRadii.control,
      backgroundColor: appearance.neutralFill,
    },
    wheel: { minWidth: 0 },
    wheelContent: { paddingVertical: ROW * Math.floor(VISIBLE_ROWS / 2) },
    wheelRow: { height: ROW, alignItems: 'center', justifyContent: 'center' },
    wheelLabel: { color: appearance.foreground, fontSize: 17 },
    wheelLabelOn: { fontWeight: '600', fontSize: 18 },
  });
