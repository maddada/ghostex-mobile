/**
 * The run of tool rows under a message (desktop `tool_run.rs`): a per-tool glyph and one-line
 * preview, the "+N previous tool calls" fold, failed results in the error tone, the subagent link,
 * and each row's arguments and result, which the core ships only while the row is open.
 */

import { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ProjectedMessage } from '../../rust/document';
import { subagentOpenAction } from '../cards';
import { useNativeChatUi, useRowDetail, useTranscriptEnv } from './context';
import { Chevron, DisclosureBody, useFoldPlace } from './Disclosure';
import { Glyph, toolGlyph } from './icons';
import { arr, obj, str, type JsonRecord } from './json';
import { useDisclosure } from './state';
import { CODE_LINE, CODE_SIZE, MONO_FONT, PROSE_LINE, PROSE_SIZE } from './theme';

const ROW_GAP = 8;

/** The tool rows of one message, folded the way the core's `toolFold` says. */
export function ToolRows({ message }: { message: ProjectedMessage }) {
  const { theme } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const { inWorkFold } = useFoldPlace();
  const tools = arr(message.tools)
    .map((tool) => obj(tool))
    .filter((tool): tool is JsonRecord => tool !== null);
  const runKey = `tool-run:${message.id}`;
  const [runOpen, toggleRun] = useDisclosure(disclosures, runKey);
  if (tools.length === 0) return null;
  // Under a heading that already folds the run, every row shows (React's `showAllRows`).
  const showAll = message.toolsShowAllRows === true;
  // An answered question is its own exchange card; it stays a plain row only where the card shows elsewhere.
  const questionsAsRows = showAll || inWorkFold;
  const visible = tools.map((_, index) => index).filter((index) => questionsAsRows || tools[index]!.exchange !== true);
  if (visible.length === 0) return null;
  const fold = obj(message.toolFold);
  const hidden = typeof fold?.hiddenCount === 'number' ? fold.hiddenCount : 0;
  const rows = (indices: number[]) =>
    indices.map((index) => <ToolRow key={index} messageId={message.id} index={index} tool={tools[index]!} />);
  if (showAll || hidden === 0) return <View style={styles.column}>{rows(visible)}</View>;
  const keptFlags = arr(fold?.visible);
  const label = str(fold, runOpen ? 'expandedLabel' : 'collapsedLabel');
  const toggle = (
    <Pressable
      onPress={toggleRun}
      accessibilityRole='button'
      accessibilityState={{ expanded: runOpen }}
      style={({ pressed }) => [styles.foldToggle, pressed && { backgroundColor: theme.pressed }]}
    >
      <Chevron open={runOpen} color={theme.muted} />
      <Text style={[styles.foldLabel, { color: theme.muted }]}>{label}</Text>
    </Pressable>
  );
  if (runOpen) {
    return (
      <DisclosureBody onCollapse={toggleRun} label='Show fewer tool calls' gap={ROW_GAP}>
        {rows(visible)}
        {toggle}
      </DisclosureBody>
    );
  }
  return (
    <View style={styles.column}>
      {rows(visible.filter((index) => keptFlags[index] === true))}
      {toggle}
    </View>
  );
}

const ToolRow = memo(function ToolRow({ messageId, index, tool }: { messageId: string; index: number; tool: JsonRecord }) {
  const { theme, dispatch } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const key = `tool:${messageId}:${index}`;
  const [open, toggle] = useDisclosure(disclosures, key);
  const hasDetail = tool.hasDetail === true;
  const expanded = open && hasDetail;
  const detail = obj(useRowDetail(key, 'tool', messageId, index, expanded));
  const failed = tool.failed === true;
  const name = str(tool, 'name');
  const preview = str(tool, 'preview');
  const subagent = str(tool.subagent, 'name');
  const openSubagent = subagentOpenAction(tool.subagent);
  const trigger = (
    <Pressable
      disabled={!hasDetail}
      onPress={toggle}
      accessibilityRole='button'
      accessibilityLabel={subagent.length > 0 ? `Tool ${name} (${subagent})` : preview.length > 0 ? `Tool ${name}: ${preview}` : `Tool ${name}`}
      accessibilityState={{ expanded }}
      style={({ pressed }) => [styles.trigger, subagent.length === 0 && styles.triggerFill, pressed && { backgroundColor: theme.pressed }]}
    >
      <View style={styles.glyphSlot}>
        <Glyph name={toolGlyph(str(tool, 'glyph'))} size={14} color={theme.muted} />
      </View>
      <Text style={[styles.name, { color: failed ? theme.error : theme.primary }]}>{name}</Text>
      {preview.length > 0 && subagent.length === 0 ? (
        <Text numberOfLines={1} style={[styles.preview, { color: theme.muted }]}>
          {preview}
        </Text>
      ) : null}
      {hasDetail ? <Glyph name={expanded ? 'chevron-down' : 'chevron-right'} size={12} color={theme.muted} /> : null}
    </Pressable>
  );
  let body = null;
  if (expanded && detail !== null) {
    const input = str(detail, 'input');
    const output = str(detail, 'output');
    const command = tool.glyph === 'terminal';
    const parts = [];
    if (input.length > 0) {
      parts.push(<ToolBody key='input' label={command ? 'Command' : output.length > 0 ? 'Input' : null} content={input} failed={false} />);
    }
    if (output.length > 0) {
      parts.push(<ToolBody key='output' label={tool.hasCall === true ? 'Result' : null} content={output} failed={failed} />);
    }
    if (parts.length > 0) {
      body = (
        <DisclosureBody onCollapse={toggle} label={`Collapse ${name}`} rail='tool'>
          {parts}
        </DisclosureBody>
      );
    }
  }
  return (
    <View style={styles.row}>
      {subagent.length === 0 ? (
        trigger
      ) : (
        <View style={styles.subagentLine}>
          {trigger}
          {openSubagent !== null ? (
            <Pressable
              onPress={() => dispatch(openSubagent)}
              accessibilityRole='button'
              accessibilityLabel={`View ${subagent}'s transcript`}
              style={styles.subagentLink}
            >
              <Text numberOfLines={1} style={[styles.subagentText, { color: theme.controlPrimary }]}>
                {subagent}
              </Text>
            </Pressable>
          ) : (
            <Text numberOfLines={1} style={[styles.subagentText, { color: theme.controlPrimary }]}>
              {subagent}
            </Text>
          )}
        </View>
      )}
      {body}
    </View>
  );
});

/** One labelled block of a tool's detail: verbatim monospaced text in a height-capped box. */
function ToolBody({ label, content, failed }: { label: string | null; content: string; failed: boolean }) {
  const { theme } = useTranscriptEnv();
  return (
    <View style={styles.bodyGroup}>
      {label !== null ? <Text style={[styles.bodyLabel, { color: theme.muted }]}>{label}</Text> : null}
      <ScrollView nestedScrollEnabled style={[styles.bodyBox, { backgroundColor: theme.input }]} contentContainerStyle={styles.bodyContent}>
        <Text selectable style={[styles.bodyText, { color: failed ? theme.error : theme.muted }]}>
          {content}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  column: { gap: ROW_GAP, minWidth: 0 },
  row: { gap: 4, minWidth: 0 },
  trigger: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 4, minWidth: 0, flexShrink: 1 },
  triggerFill: { alignSelf: 'stretch' },
  glyphSlot: { width: 16, marginLeft: 2, height: PROSE_LINE, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: PROSE_SIZE, lineHeight: PROSE_LINE, flexShrink: 0 },
  preview: { fontFamily: MONO_FONT, fontSize: CODE_SIZE, flexShrink: 1, minWidth: 0 },
  subagentLine: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  subagentLink: { flexShrink: 1, minWidth: 0 },
  subagentText: { fontSize: PROSE_SIZE, lineHeight: PROSE_LINE },
  foldToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 4 },
  foldLabel: { fontSize: PROSE_SIZE, lineHeight: PROSE_LINE },
  bodyGroup: { gap: 4, minWidth: 0 },
  bodyLabel: { fontSize: 12.25 },
  bodyBox: { maxHeight: 220.75, borderRadius: 6 },
  bodyContent: { paddingHorizontal: 10, paddingVertical: 8 },
  bodyText: { fontFamily: MONO_FONT, fontSize: CODE_SIZE, lineHeight: CODE_LINE },
});
