/**
 * The model sheet's own view state over the core's `modelMenu`, the part desktop keeps in
 * `ModelMenuState` (`option_menu/model_menu/state.rs`) rather than in the core: which row is
 * highlighted, the reasoning level picked for a row this visit, and the Reasoning button that
 * follows the highlighted row. Everything else the sheet draws is the document as it arrives.
 */

import { arr, isTrue, obj, str, type JsonRecord } from './json';

/** Past this many, the footer's buttons wrap onto another line (`style.rs`, `BUTTONS_PER_LINE`). */
const BUTTONS_PER_LINE = 4;

/** How many lines the footer's buttons take, and how many sit on each (`style.rs`, `button_lines`). */
export function buttonLines(buttons: number): { lines: number; perLine: number } {
  const lines = Math.ceil(buttons / BUTTONS_PER_LINE);
  return { lines, perLine: lines === 0 ? 0 : Math.ceil(buttons / lines) };
}

/** The footer buttons split into their lines. */
export function footerLines<T>(buttons: readonly T[]): T[][] {
  const perLine = Math.max(buttonLines(buttons.length).perLine, 1);
  const lines: T[][] = [];
  for (let start = 0; start < buttons.length; start += perLine) lines.push(buttons.slice(start, start + perLine));
  return lines;
}

/** The level a pick of `row` carries: where the level chips left it this visit, else the row's own (`effort_for`). */
export function effortFor(row: JsonRecord, efforts: Readonly<Record<string, string>>): string {
  return efforts[str(row, 'key')] ?? str(row, 'effort');
}

/**
 * CDXC:SessionChat 2026-09-25 SEE-ALSO: `reasoning_for` in apps/desktop/src/app/native_chat/option_menu/model_menu/state.rs and `modelMenuReasoningFor` in packages/shared/session-chat-presentation/model-menu.ts draw the same button; keep the three in step.
 * The Reasoning button for the highlighted row: its levels, with the one the chips moved to
 * marked. `browse` names the row, and `browseCurrent` says whether it is the model in use, whose
 * level a choice from the list applies at once.
 */
export function reasoningFor(setting: JsonRecord, row: JsonRecord | null, effort: string | null): JsonRecord {
  if (row === null || effort === null) return setting;
  const levels = arr(row.efforts);
  if (levels.length === 0) return setting;
  const selected = isTrue(row, 'selected');
  if (
    str(setting, 'id') !== 'effort' ||
    (selected && arr(setting.choices).some((choice) => isTrue(choice, 'selected') && obj(choice)?.value === effort))
  ) {
    return setting;
  }
  const { toggle: _toggle, ...rest } = setting;
  const level = levels.find((entry) => obj(entry)?.value === effort);
  return {
    ...rest,
    disabled: false,
    ...(level !== undefined && typeof obj(level)?.label === 'string' ? { valueLabel: str(level, 'label') } : {}),
    choices: levels.map((entry) => ({
      value: obj(entry)?.value ?? null,
      label: obj(entry)?.label ?? null,
      selected: obj(entry)?.value === effort,
      isDefault: false,
    })),
    browse: row.key ?? null,
    browseCurrent: selected,
  };
}
