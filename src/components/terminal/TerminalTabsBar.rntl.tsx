/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. REQ-DUO-005 AC2 (folded: the Terminal tabs stay usable in the status band)
 * and REQ-DUO-001 AC5 (inner display). Owner decisions 2026-10-28 (Terminal tabs stay in the status band, "es muss
 * deutlich sein, dass man wischen kann"): in a strip too narrow for every tab the second tab shows by at
 * least a quarter of a tab and the edge that hides more tabs fades; one tab and a strip that fits are
 * unchanged. The real `TerminalTabsBar`; the test renderer measures nothing, so the track's and the
 * scroll content's sizes are fired as the layout events React Native would send.
 */

import { ScrollView, StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { TerminalTab } from '../../terminal/sessions';
import TerminalTabsBar from './TerminalTabsBar';
import { TAB_PEEK_FRACTION, TAB_SPACING, TRACK_INNER_PAD } from './tabStrip';

const tab = (name: string): TerminalTab => ({
  sessionKey: name,
  machineId: 'm',
  title: name,
  kind: 'attach',
  state: 'open',
});

type Node = ReturnType<typeof screen.getByRole>;

/** The nearest ancestor (or the node itself) that satisfies `match`. */
function up(node: Node | null, match: (node: Node) => boolean): Node {
  let current = node;
  while (current !== null && !match(current)) current = current.parent;
  if (current === null) throw new Error('no such ancestor');
  return current;
}

// The shared fade draws with react-native-svg; the test only needs to see that it is drawn and in what colour.
jest.mock('../../chat/native/transcript/verticalFade', () => {
  const { View } = jest.requireActual('react-native');
  return {
    HorizontalFade: ({ color }: { color: string }) => <View testID="tab-fade" accessibilityHint={color} />,
  };
});

const flat = (node: Node) => StyleSheet.flatten(node.props.style);

async function show(titles: string[], trackWidth: number, headerColor?: string) {
  const tabs = titles.map(tab);
  await render(
    <TerminalTabsBar
      tabs={tabs}
      selectedSessionKey={titles[0]}
      onSelect={() => undefined}
      onClose={() => undefined}
      headerColor={headerColor}
    />,
  );
  // The capsule around the tabs is the first ancestor with a layout handler.
  const track = up(screen.getAllByRole('tab')[0], (node) => node.props.onLayout !== undefined);
  await fireEvent(track, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: trackWidth, height: 36 } } });
}

/** Each tab's slot width (undefined where it fills the track). */
const slotWidths = (): (number | undefined)[] =>
  screen
    .getAllByRole('tab')
    .map((tabNode) => flat(up(tabNode.parent, (node) => flat(node)?.height === 28))?.width as number | undefined);

/** The edge fades: views carrying a gradient. */
const fadeCount = (): number => screen.queryAllByTestId('tab-fade').length;

test('narrow strip, three tabs: the second tab peeks in by at least a quarter of a tab', async () => {
  await show(['one', 'two', 'three'], 116);
  const widths = slotWidths();
  expect(widths).toHaveLength(3);
  const w = widths[0] ?? 0;
  expect(w).toBeGreaterThan(0);
  const visible = 116 - TRACK_INNER_PAD * 2;
  const peek = visible - (w + TAB_SPACING);
  expect(peek).toBeGreaterThanOrEqual(TAB_PEEK_FRACTION * w - 0.5);
  expect(w).toBeGreaterThanOrEqual(80);
});

test('the edge that hides more tabs fades: right at the start, none once everything is in view', async () => {
  await show(['one', 'two', 'three'], 116);
  const scroll = up(screen.getAllByRole('tab')[0], (node) => node.props.onContentSizeChange !== undefined);
  await fireEvent(scroll, 'contentSizeChange', 300, 28);
  expect(fadeCount()).toBe(1);
  await fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { x: 100, y: 0 } } });
  expect(fadeCount()).toBe(2);
});

test('one tab is unchanged: it fills the track, no peek, no fade', async () => {
  await show(['only'], 116);
  expect(slotWidths()).toEqual([undefined]);
  expect(fadeCount()).toBe(0);
});

test('a strip that fits every tab keeps the equal-width look, no fade', async () => {
  await show(['one', 'two', 'three'], 600);
  expect(slotWidths()).toEqual([undefined, undefined, undefined]);
  expect(fadeCount()).toBe(0);
});

test('the fade takes its colour from the header it stands in, in a dark and a light theme', async () => {
  const gradient = (): string =>
    screen
      .getAllByTestId('tab-fade')
      .map((node) => String(node.props.accessibilityHint))
      .join('|');
  for (const [header, solid] of [
    ['#000000', 'rgb(20,20,20)'],
    ['#ffffff', 'rgb(255,255,255)'],
  ] as const) {
    await show(['one', 'two', 'three'], 116, header);
    const scroll = up(screen.getAllByRole('tab')[0], (node) => node.props.onContentSizeChange !== undefined);
    await fireEvent(scroll, 'contentSizeChange', 300, 28);
    expect(gradient()).toContain(solid);
    await screen.unmount();
  }
});

const closeButtons = () => screen.queryAllByLabelText(/^Close /);

test('narrow strip: only the active tab shows its close button, the others show their title', async () => {
  await show(['one', 'two', 'three'], 116);
  expect(closeButtons()).toHaveLength(1);
  expect(screen.getByLabelText('Close one')).toBeTruthy();
  expect(screen.getByText('two')).toBeTruthy();
  expect(screen.getByText('three')).toBeTruthy();
});

test("wide strip and one tab keep today's look: a close button on every tab", async () => {
  await show(['one', 'two', 'three'], 600);
  expect(closeButtons()).toHaveLength(3);
  await screen.unmount();
  await show(['only'], 116);
  expect(closeButtons()).toHaveLength(1);
});

describe('the strip scrolls to the active tab only when the active tab changes', () => {
  const scrollTo = ScrollView.prototype.scrollTo as jest.Mock;
  const tabs = ['one', 'two', 'three'].map(tab);
  const bar = (selected: string) => (
    <TerminalTabsBar tabs={tabs} selectedSessionKey={selected} onSelect={() => undefined} onClose={() => undefined} />
  );

  async function narrow() {
    await render(bar('three'));
    const track = up(screen.getAllByRole('tab')[0], (node) => node.props.onLayout !== undefined);
    await fireEvent(track, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 116, height: 36 } } });
    const scroll = up(screen.getAllByRole('tab')[0], (node) => node.props.onContentSizeChange !== undefined);
    await fireEvent(scroll, 'contentSizeChange', 300, 28);
    return scroll;
  }

  /** The active tab's slot reports a fresh layout, as React Native does when the strip reflows. */
  const reflow = () => {
    const slot = up(screen.getByLabelText('Close three').parent, (node) => node.props.onLayout !== undefined);
    return fireEvent(slot, 'layout', { nativeEvent: { layout: { x: 160, y: 0, width: 84, height: 28 } } });
  };

  test('a manual scroll survives a re-render and a reflow with the same active tab', async () => {
    const scroll = await narrow();
    await reflow();
    expect(scrollTo).toHaveBeenCalled();
    scrollTo.mockClear();
    await fireEvent(scroll, 'scrollBeginDrag');
    await fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { x: 0, y: 0 } } });
    await screen.rerender(bar('three'));
    await reflow();
    await fireEvent(scroll, 'contentSizeChange', 300, 28);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  test('choosing another tab scrolls to it again', async () => {
    const scroll = await narrow();
    await fireEvent(scroll, 'scrollBeginDrag');
    scrollTo.mockClear();
    await screen.rerender(bar('two'));
    const slot = up(screen.getByLabelText('Close two').parent, (node) => node.props.onLayout !== undefined);
    await fireEvent(slot, 'layout', { nativeEvent: { layout: { x: 88, y: 0, width: 84, height: 28 } } });
    expect(scrollTo).toHaveBeenCalled();
  });
});

/*
 * The real component, not the model: the offset it actually hands to the ScrollView. Owner 2026-10-28,
 * "es muss deutlich sein, dass man wischen kann": with a narrow strip the neighbour of the active tab peeks
 * in by at least a quarter of a tab (the previous one for the last tab), and the active tab is whole.
 */
describe('the offset the strip scrolls to (116 pt track, 3 tabs)', () => {
  const scrollTo = ScrollView.prototype.scrollTo as jest.Mock;
  const TRACK = 116;
  const PAD = 4;
  const GAP = 4;
  const titles = ['one', 'two', 'three'];

  async function offsetFor(active: string): Promise<{ x: number; width: number }> {
    scrollTo.mockClear();
    await render(
      <TerminalTabsBar
        tabs={titles.map(tab)}
        selectedSessionKey={active}
        onSelect={() => undefined}
        onClose={() => undefined}
      />,
    );
    const track = up(screen.getAllByRole('tab')[0], (node) => node.props.onLayout !== undefined);
    await fireEvent(track, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: TRACK, height: 36 } } });
    const scroll = up(screen.getAllByRole('tab')[0], (node) => node.props.onContentSizeChange !== undefined);
    const width = slotWidths()[0] as number;
    await fireEvent(scroll, 'contentSizeChange', 2 * PAD + 3 * width + 2 * GAP, 28);
    const call = scrollTo.mock.calls.at(-1);
    if (call === undefined) throw new Error('the strip never scrolled');
    await screen.unmount();
    return { x: call[0].x as number, width };
  }

  /** The fraction of tab `index` inside the viewport [x, x + TRACK]. */
  const shown = (index: number, width: number, x: number): number => {
    const start = PAD + index * (width + GAP);
    return Math.max(0, Math.min(start + width, x + TRACK) - Math.max(start, x)) / width;
  };

  test.each([
    ['one', 0, 1],
    ['two', 1, 2],
    ['three', 2, 1],
  ])(
    'with %s active the active tab is whole and its neighbour shows by at least a quarter',
    async (name, index, other) => {
      const { x, width } = await offsetFor(name);
      expect(shown(index, width, x)).toBeGreaterThanOrEqual(0.999);
      expect(shown(other, width, x)).toBeGreaterThanOrEqual(0.25);
    },
  );
});
