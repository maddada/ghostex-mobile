/**
 * A question's words with their links (the core's runs, gx-chat-core `questions/form_links.rs`):
 * each link in the text's own colour with a faint dotted underline, opening on a tap the way a
 * message's link does (`openMarkdownLink`). A bare `#407` (an `issue` run, gx-chat-core
 * `transcript/issue_links.rs` decides which numbers are one) links to the project's GitHub issue the
 * same way when the project has a GitHub `origin` (`useIssueLinkBase`, as a reply's `#407` in
 * `Markdown.tsx`), and stays text without one. Desktop draws the same in apps/desktop/src/app/native_chat/link_words.rs,
 * whose dots are a session name's on a "Message to" card; the phone has no hover, so its dots sit
 * between that name's resting and hovered strength.
 */

import { Text, type StyleProp, type TextStyle } from 'react-native';

import { useIssueLinkBase, useTranscriptEnv } from './context';
import { arr, str } from './json';

/** How strong the dotted underline is (desktop: 0.3 at rest, full under the pointer). */
const UNDERLINE_ALPHA = 0.5;

/** `#rrggbb` at an alpha; any other colour as it is. */
function faint(color: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return color;
  return `${color}${Math.round(UNDERLINE_ALPHA * 255)
    .toString(16)
    .padStart(2, '0')}`;
}

/**
 * The faint dotted underline that marks words a tap opens, in `color` (the words' own): a link here,
 * and the session's name on a "Message from" / "Message to" card (`SessionPill`, desktop
 * `session_name_underline`). Android draws it solid, as it draws no dotted line.
 */
export function dottedUnderline(color: string): TextStyle {
  return { textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: faint(color) };
}

export function LinkWords({
  text,
  runs,
  color,
  style,
}: {
  /** The words as plain text, drawn as they are when `runs` is not an array. */
  text: string;
  runs: unknown;
  /** The text's colour, which its links keep. */
  color: string;
  style: StyleProp<TextStyle>;
}) {
  const { dispatch } = useTranscriptEnv();
  const issueLinkBase = useIssueLinkBase();
  if (!Array.isArray(runs)) return <Text style={[style, { color }]}>{text}</Text>;
  return (
    <Text style={[style, { color }]}>
      {arr(runs).map((run, index) => {
        const words = str(run, 'text');
        const issue = str(run, 'issue');
        const href = str(run, 'href') || (issue.length > 0 && issueLinkBase !== null ? `${issueLinkBase}${issue}` : '');
        if (href.length === 0) return words;
        return (
          <Text
            key={index}
            accessibilityRole="link"
            suppressHighlighting={false}
            onPress={() => dispatch({ type: 'openMarkdownLink', href, external: false })}
            style={dottedUnderline(color)}
          >
            {words}
          </Text>
        );
      })}
    </Text>
  );
}
