/**
 * The place a Settings search result lands on (`SettingsSearchFocus`) and the choice of the row it lands on among a
 * page's rows (`focusedAnchor`). Kept free of React Native, so the search list and its tests use it without the
 * page's drawing (SettingsSearchAnchor.tsx, which registers the rows and scrolls to the chosen one).
 */

export type SettingsSearchAnchorKind = 'row' | 'header';

export type SettingsSearchTarget = { readonly kind: SettingsSearchAnchorKind; readonly label: string };

/**
 * A result's place on its page, carried in the `SettingsPage` route's params. `section` is the `SettingsSection` name
 * ('' for a page without sections); `target` null lands on the section's top. `standIn`, a row of the same section,
 * is landed on while `target` is not on the page (it shows once a choice there is made), and the page moves on to
 * `target` when it shows. `at` tells two taps of one result apart.
 */
export type SettingsSearchFocus = {
  readonly section: string;
  readonly target: SettingsSearchTarget | null;
  readonly standIn?: SettingsSearchTarget;
  readonly at: number;
};

/**
 * Where `focus` lands among a page's anchors now: its row (`exact`), else its stand-in row, else nothing yet (the page
 * then waits for the row and, after a moment, settles for the top of its section).
 */
export function focusedAnchor<A extends { section: string; kind: SettingsSearchAnchorKind; label: string }>(
  anchors: Iterable<A>,
  focus: Omit<SettingsSearchFocus, 'at'>,
): { anchor: A; exact: boolean } | null {
  const inSection = [...anchors].filter((anchor) => anchor.section === focus.section);
  const find = (target: SettingsSearchTarget | null | undefined): A | undefined =>
    target == null
      ? undefined
      : inSection.find((anchor) => anchor.kind === target.kind && anchor.label === target.label);
  const row = find(focus.target);
  if (row !== undefined) return { anchor: row, exact: true };
  const standIn = find(focus.standIn);
  return standIn === undefined ? null : { anchor: standIn, exact: false };
}
