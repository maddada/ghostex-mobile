/**
 * The Tabler glyphs the chat cards draw, copied from the desktop's `apps/desktop/assets/titlebar/`
 * SVGs (the same files the GPUI cards name, e.g. `titlebar/help-circle.svg`).
 */

import Svg, { Path } from 'react-native-svg';

import { CAPTAIN_HAT_PATH } from '../../../components/sessions/icons';

type GlyphSpec = { paths: string[]; strokeWidth?: number; filled?: boolean };

const GLYPHS = {
  /** The "+N" pill and its sheet (desktop `titlebar/dots.svg`). */
  dots: { paths: ['M4 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0', 'M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0', 'M18 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0'] },
  'arrow-down': { paths: ['M12 5l0 14', 'M18 13l-6 6', 'M6 13l6 6'] },
  'question-mark': {
    paths: ['M8.5 8.5a3.5 3.5 0 1 1 4.9 3.2c-.8 .4 -1.4 1.1 -1.4 2v.3', 'M12 18.5v.01'],
    strokeWidth: 2.6,
  },
  'help-circle': {
    paths: [
      'M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0',
      'M12 16v.01',
      'M12 13a2 2 0 0 0 .914 -3.782a1.98 1.98 0 0 0 -2.414 .483',
    ],
  },
  'chevron-right': { paths: ['M9 6l6 6l-6 6'] },
  /** The Board pill (desktop `titlebar/layout-board-split.svg`). */
  'layout-board-split': {
    paths: [
      'M4.1 3h5.8a1.1 1.1 0 0 1 1.1 1.1v5.8a1.1 1.1 0 0 1 -1.1 1.1h-5.8a1.1 1.1 0 0 1 -1.1 -1.1v-5.8a1.1 1.1 0 0 1 1.1 -1.1z',
      'M14.1 3h5.8a1.1 1.1 0 0 1 1.1 1.1v2.8a1.1 1.1 0 0 1 -1.1 1.1h-5.8a1.1 1.1 0 0 1 -1.1 -1.1v-2.8a1.1 1.1 0 0 1 1.1 -1.1z',
      'M14.1 10h5.8a1.1 1.1 0 0 1 1.1 1.1v1.8a1.1 1.1 0 0 1 -1.1 1.1h-5.8a1.1 1.1 0 0 1 -1.1 -1.1v-1.8a1.1 1.1 0 0 1 1.1 -1.1z',
      'M14.1 16h5.8a1.1 1.1 0 0 1 1.1 1.1v2.8a1.1 1.1 0 0 1 -1.1 1.1h-5.8a1.1 1.1 0 0 1 -1.1 -1.1v-2.8a1.1 1.1 0 0 1 1.1 -1.1z',
      'M4.1 13h5.8a1.1 1.1 0 0 1 1.1 1.1v5.8a1.1 1.1 0 0 1 -1.1 1.1h-5.8a1.1 1.1 0 0 1 -1.1 -1.1v-5.8a1.1 1.1 0 0 1 1.1 -1.1z',
    ],
    filled: true,
  },
  'chevron-down': { paths: ['M6 9l6 6l6-6'] },
  /** The coordinator tips' pill and their cards (desktop `titlebar/<name>.svg`, CoordinatorIntro.tsx). */
  bulb: {
    paths: [
      'M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7',
      'M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3',
      'M9.7 17l4.6 0',
    ],
  },
  /** A coordinator: the user's traced picture (`CAPTAIN_HAT_PATH`, components/sessions/icons.tsx). */
  'coordinator-captain-hat': { paths: [CAPTAIN_HAT_PATH], filled: true },
  'file-type-html': {
    paths: [
      'M14 3v4a1 1 0 0 0 1 1h4',
      'M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4',
      'M2 21v-6',
      'M5 15v6',
      'M2 18h3',
      'M20 15v6h2',
      'M13 21v-6l2 3l2 -3v6',
      'M7.5 15h3',
      'M9 15v6',
    ],
  },
  microscope: {
    paths: [
      'M5 21h14',
      'M6 18h2',
      'M7 18v3',
      'M9 11l3 3l6 -6l-3 -3l-6 6',
      'M10.5 12.5l-1.5 1.5',
      'M17 3l3 3',
      'M12 21a6 6 0 0 0 3.715 -10.712',
    ],
  },
  'users-group': {
    paths: [
      'M10 13a2 2 0 1 0 4 0a2 2 0 0 0 -4 0',
      'M8 21v-1a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v1',
      'M15 5a2 2 0 1 0 4 0a2 2 0 0 0 -4 0',
      'M17 10h2a2 2 0 0 1 2 2v1',
      'M5 5a2 2 0 1 0 4 0a2 2 0 0 0 -4 0',
      'M3 13v-1a2 2 0 0 1 2 -2h2',
    ],
  },
  checklist: {
    paths: [
      'M9.615 20h-2.615a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8',
      'M14 19l2 2l4 -4',
      'M9 8h4',
      'M9 12h2',
    ],
  },
  note: {
    paths: ['M13 20l7 -7', 'M13 20v-6a1 1 0 0 1 1 -1h6v-7a2 2 0 0 0 -2 -2h-12a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7'],
  },
  bell: {
    paths: [
      'M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6',
      'M9 17v1a3 3 0 0 0 6 0v-1',
    ],
  },
  'device-desktop': {
    paths: [
      'M3 5a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1v-10',
      'M7 20h10',
      'M9 16v4',
      'M15 16v4',
    ],
  },
  'arrow-down-left': { paths: ['M17 7l-10 10', 'M16 17l-9 0l0 -9'] },
  'chevron-left': { paths: ['M15 6l-6 6l6 6'] },
  'chevron-up': { paths: ['M6 15l6-6l6 6'] },
  'message-circle': {
    paths: [
      'M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1',
    ],
  },
  'git-fork': {
    paths: [
      'M10 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
      'M5 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
      'M15 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
      'M7 8v2a2 2 0 0 0 2 2h6a2 2 0 0 0 2 -2v-2',
      'M12 12l0 4',
    ],
    strokeWidth: 1.8,
  },
  check: { paths: ['M5 12l4 4L19 6'] },
  /** The Recommended mark's star (desktop `titlebar/star-filled.svg`). */
  star: {
    paths: ['m12 17.27-5.18 3.04 1.4-5.9-4.58-3.98 6.04-.5L12 4.34l2.32 5.59 6.04.5-4.58 3.98 1.4 5.9z'],
    filled: true,
  },
  pencil: { paths: ['M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4', 'M13.5 6.5l4 4'] },
  x: { paths: ['M18 6l-12 12', 'M6 6l12 12'], strokeWidth: 1.8 },
  clock: { paths: ['M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0', 'M12 7v5l3 3'] },
  /** The Resources pill's glyph (desktop `titlebar/stack.svg`). */
  stack: { paths: ['M12 6l-8 4l8 4l8 -4l-8 -4', 'M4 14l8 4l8 -4'] },
  /** The Stashed pill's glyph (desktop `titlebar/stack-push.svg`). */
  'stack-push': { paths: ['M6 10l-2 1l8 4l8 -4l-2 -1', 'M4 15l8 4l8 -4', 'M12 4v7', 'M15 8l-3 3l-3 -3'] },
  /** "Back to open" on a For later row (desktop `titlebar/arrow-back-up.svg`). */
  'arrow-back-up': { paths: ['M9 14l-4 -4l4 -4', 'M5 10h11a4 4 0 1 1 0 8h-1'] },
  /** The GBot added card's Open settings (desktop `titlebar/settings.svg`). */
  settings: {
    paths: [
      'M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065',
      'M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0',
    ],
  },
  messages: {
    paths: [
      'M21 14l-3 -3h-7a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1h9a1 1 0 0 1 1 1v10',
      'M14 15v2a1 1 0 0 1 -1 1h-7l-3 3v-10a1 1 0 0 1 1 -1h2',
    ],
  },
  trash: {
    paths: [
      'M4 7l16 0',
      'M10 11l0 6',
      'M14 11l0 6',
      'M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12',
      'M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3',
    ],
  },
  lock: {
    paths: [
      'M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6z',
      'M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0',
      'M8 11v-4a4 4 0 1 1 8 0v4',
    ],
  },
  'shield-check': {
    paths: [
      'M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06',
      'M15 19l2 2l4 -4',
    ],
  },
  'alert-circle': { paths: ['M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0', 'M12 8v4', 'M12 16h.01'], strokeWidth: 1.8 },
  'alert-triangle': {
    paths: [
      'M12 9v4',
      'M12 17h.01',
      'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
    ],
  },
  'info-circle': { paths: ['M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0', 'M12 9h.01', 'M11 12h1v4h1'] },
  'terminal-2': {
    paths: [
      'M8 9l3 3l-3 3',
      'M13 15l3 0',
      'M3 6a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -12',
    ],
  },
  users: {
    paths: [
      'M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0',
      'M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2',
      'M16 3.13a4 4 0 0 1 0 7.75',
      'M21 21v-2a4 4 0 0 0 -3 -3.85',
    ],
    strokeWidth: 1.8,
  },
  'list-check': {
    paths: [
      'M3.5 5.5l1.5 1.5l2.5 -2.5',
      'M3.5 11.5l1.5 1.5l2.5 -2.5',
      'M3.5 17.5l1.5 1.5l2.5 -2.5',
      'M11 6l9 0',
      'M11 12l9 0',
      'M11 18l9 0',
    ],
  },
  loader: { paths: ['M12 3a9 9 0 1 0 9 9'], strokeWidth: 1.8 },
  'circle-check-filled': {
    paths: [
      'M17 3.34a10 10 0 1 1 -14.995 8.984l-.005 -.324l.005 -.324a10 10 0 0 1 14.995 -8.336zm-1.293 5.953a1 1 0 0 0 -1.32 -.083l-.094 .083l-3.293 3.292l-1.293 -1.292l-.094 -.083a1 1 0 0 0 -1.403 1.403l.083 .094l2 2l.094 .083a1 1 0 0 0 1.226 0l.094 -.083l4 -4l.083 -.094a1 1 0 0 0 -.083 -1.32z',
    ],
    filled: true,
  },
  message: {
    paths: ['M8 9h8', 'M8 13h5', 'M5 19l2.5 -2h9.5a3 3 0 0 0 3 -3v-6a3 3 0 0 0 -3 -3h-10a3 3 0 0 0 -3 3v10.5z'],
  },
  'switch-horizontal': { paths: ['M16 3l4 4l-4 4', 'M10 7l10 0', 'M8 13l-4 4l4 4', 'M4 17l9 0'] },
  refresh: { paths: ['M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4', 'M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4'] },
  copy: {
    paths: [
      'M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666',
      'M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1',
    ],
  },
  /** The Autopilot pill (desktop `titlebar/plane.svg`). */
  plane: { paths: ['M16 10h4a2 2 0 0 1 0 4h-4l-4 7h-3l2 -7h-4l-2 2h-3l2 -4l-2 -4h3l2 2h4l-2 -7h3z'] },
  robot: {
    paths: [
      'M6 6a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2l0 -4',
      'M12 2v2',
      'M9 12v9',
      'M15 12v9',
      'M5 16l4 -2',
      'M15 14l4 2',
      'M9 18h6',
      'M10 8v.01',
      'M14 8v.01',
    ],
  },
  folder: { paths: ['M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2'] },
  'photo-off': {
    paths: [
      'M15 8h.01',
      'M7 3h11a3 3 0 0 1 3 3v11m-.856 3.099a2.991 2.991 0 0 1 -2.144 .901h-12a3 3 0 0 1 -3 -3v-12c0 -.845 .349 -1.608 .91 -2.153',
      'M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5',
      'M16.33 12.338c.574 -.054 1.155 .166 1.67 .662l3 3',
      'M3 3l18 18',
    ],
  },
  'wifi-off': {
    paths: [
      'M12 18l.01 0',
      'M9.172 15.172a4 4 0 0 1 5.656 0',
      'M6.343 12.343a7.963 7.963 0 0 1 3.864 -2.14m4.163 .155a7.965 7.965 0 0 1 3.287 2',
      'M3.515 9.515a12 12 0 0 1 3.544 -2.455m3.101 -.92a12 12 0 0 1 10.325 3.374',
      'M3 3l18 18',
    ],
  },
  server: {
    paths: [
      'M3 7a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3',
      'M3 15a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3l0 -2',
      'M7 8l0 .01',
      'M7 16l0 .01',
    ],
  },
  photo: {
    paths: [
      'M15 8h.01',
      'M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12',
      'M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5',
      'M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3',
    ],
  },
  /** Board card menus and the Blocked pill (desktop `titlebar/*.svg` of the same names). */
  'external-link': {
    paths: ['M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6', 'M11 13l9 -9', 'M15 4h5v5'],
  },
  'message-plus': {
    paths: [
      'M8 9h8',
      'M8 13h6',
      'M12.01 18.594l-4.01 2.406v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v5.5',
      'M16 19h6',
      'M19 16v6',
    ],
  },
  'circle-check': { paths: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0', 'M9 12l2 2l4 -4'] },
  'circle-minus': { paths: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0', 'M9 12l6 0'] },
  tag: {
    paths: [
      'M6.5 7.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0',
      'M3 6v5.172a2 2 0 0 0 .586 1.414l7.71 7.71a2.41 2.41 0 0 0 3.408 0l5.592 -5.592a2.41 2.41 0 0 0 0 -3.408l-7.71 -7.71a2 2 0 0 0 -1.414 -.586h-5.172a3 3 0 0 0 -3 3z',
    ],
  },
  /** The Share sheet (CollabShareMenu.tsx): the desktop popover's `titlebar/<name>.svg` glyphs. */
  puzzle: {
    paths: [
      'M4 7h3a1 1 0 0 0 1 -1v-1a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h3a1 1 0 0 1 1 1v3a1 1 0 0 0 1 1h1a2 2 0 0 1 0 4h-1a1 1 0 0 0 -1 1v3a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-1a2 2 0 0 0 -4 0v1a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1h1a2 2 0 0 0 0 -4h-1a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1',
    ],
  },
  'eye-off': {
    paths: [
      'M10.585 10.587a2 2 0 0 0 2.829 2.828',
      'M16.681 16.673a8.717 8.717 0 0 1 -4.681 1.327c-3.6 0 -6.6 -2 -9 -6c1.272 -2.12 2.712 -3.678 4.32 -4.674m2.86 -1.146a9.055 9.055 0 0 1 1.82 -.18c3.6 0 6.6 2 9 6c-.666 1.11 -1.379 2.067 -2.138 2.87',
      'M3 3l18 18',
    ],
  },
  link: {
    paths: [
      'M9 15l6 -6',
      'M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464',
      'M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463',
    ],
  },
  world: {
    paths: [
      'M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0',
      'M3.6 9h16.8',
      'M3.6 15h16.8',
      'M11.5 3a17 17 0 0 0 0 18',
      'M12.5 3a17 17 0 0 1 0 18',
    ],
  },
  download: { paths: ['M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2', 'M7 11l5 5l5 -5', 'M12 4l0 12'] },
  'player-pause': {
    paths: [
      'M6 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z',
      'M14 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z',
    ],
  },
  'player-play': { paths: ['M7 4v16l13 -8z'] },
  'player-stop': { paths: ['M5 7a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2l0 -10'] },
  user: { paths: ['M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0', 'M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2'] },
  send: { paths: ['M10 14l11 -11', 'M21 3l-6.5 18a.55 .55 0 0 1 -1 0l-3.5 -7l-7 -3.5a.55 .55 0 0 1 0 -1l18 -6.5'] },
  'loader-2': { paths: ['M12 3a9 9 0 1 0 9 9'] },
} satisfies Record<string, GlyphSpec>;

export type GlyphName = keyof typeof GLYPHS;

export function Glyph({
  name,
  size,
  color,
  strokeWidth,
}: {
  name: GlyphName;
  size: number;
  color: string;
  strokeWidth?: number;
}) {
  const spec: GlyphSpec = GLYPHS[name];
  const width = strokeWidth ?? spec.strokeWidth ?? 2;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {spec.paths.map((d) =>
        spec.filled ? (
          <Path key={d} d={d} fill={color} />
        ) : (
          <Path
            key={d}
            d={d}
            stroke={color}
            strokeWidth={width}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ),
      )}
    </Svg>
  );
}

/** The working strip's spark (`sparkPath` in packages/gx-chat-core/visual/working-strip.json). */
export const SPARK_PATH =
  'M12 0.8c.5 4.6 1.8 7.4 3.6 9.1 1.6 1.6 4.2 2.5 7.6 2.1-3.4-.4-6 .5-7.6 2.1-1.8 1.7-3.1 4.5-3.6 9.1-.5-4.6-1.8-7.4-3.6-9.1C6.8 12.5 4.2 11.6.8 12c3.4.4 6-.5 7.6-2.1C10.2 8.2 11.5 5.4 12 .8z';

/** Transparent units around the glyph so the rotating spark never has opaque pixels on its edge (mirrors `SPARK_PAD` in apps/desktop/src/assets/chat_working.rs). */
const SPARK_PAD = 4;

export function Spark({ size, color }: { size: number; color: string }) {
  const box = (size * (24 + 2 * SPARK_PAD)) / 24;
  return (
    <Svg width={box} height={box} viewBox={`${-SPARK_PAD} ${-SPARK_PAD} ${24 + 2 * SPARK_PAD} ${24 + 2 * SPARK_PAD}`}>
      <Path d={SPARK_PATH} fill={color} />
    </Svg>
  );
}
