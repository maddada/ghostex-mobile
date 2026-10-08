/**
 * The run of tool rows under a message (desktop `tool_run.rs`): a per-tool glyph and one-line
 * preview, the "+N previous tool calls" fold, failed results in the error tone, the subagent link,
 * and each row's arguments and result, which the core ships only while the row is open.
 */

import * as Clipboard from 'expo-clipboard';
import { memo, useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ProjectedMessage } from '../../rust/document';
import { subagentOpenAction } from '../cards';
import { useNativeChatUi, useRowDetail, useTranscriptEnv } from './context';
import { Chevron, DisclosureBody, DisclosureHeading, useFoldPlace } from './Disclosure';
import { Glyph, toolGlyph } from './icons';
import { arr, obj, str, type JsonRecord } from './json';
import { useDisclosure } from './state';
import { CODE_LINE, CODE_SIZE, MONO_FONT, PROSE_LINE, PROSE_SIZE } from './theme';

const ROW_GAP = 8;

/**
 * The tool rows of one message, folded the way the core's `toolFold` says, or in Simple mode
 * behind one "N tool calls" heading (desktop `tool_run.rs`).
 */
export function ToolRows({ message }: { message: ProjectedMessage }) {
  const { theme, simple } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const { inWorkFold } = useFoldPlace();
  const tools = arr(message.tools)
    .map((tool) => obj(tool))
    .filter((tool): tool is JsonRecord => tool !== null);
  const runKey = `tool-run:${message.id}`;
  const [runOpen, toggleRun] = useDisclosure(disclosures, runKey);
  // Simple mode's run heading opens on demand only; verbose mode never opens it.
  const [simpleOpen, toggleSimple] = useDisclosure(disclosures, `tools:${message.id}`);
  if (tools.length === 0) return null;
  // Under a heading that already folds the run, every row shows (React's `showAllRows`).
  const showAll = message.toolsShowAllRows === true;
  // An answered question is its own exchange card and a message sent to another agent its own message
  // card; each stays a plain row only where its card shows elsewhere.
  const cardsAsRows = showAll || inWorkFold;
  const visible = tools
    .map((_, index) => index)
    .filter((index) => cardsAsRows || (tools[index]!.exchange !== true && tools[index]!.sentMessage !== true));
  if (visible.length === 0) return null;
  const fold = obj(message.toolFold);
  const hidden = typeof fold?.hiddenCount === 'number' ? fold.hiddenCount : 0;
  const rows = (indices: number[]) =>
    indices.map((index) => <ToolRow key={index} messageId={message.id} index={index} tool={tools[index]!} />);
  if (simple && !showAll) {
    return (
      <View style={styles.column}>
        <DisclosureHeading label={str(message, 'simpleToolLabel')} open={simpleOpen} onToggle={toggleSimple} />
        {simpleOpen ? (
          <DisclosureBody onCollapse={toggleSimple} label='Collapse tool calls' gap={ROW_GAP}>
            {rows(visible)}
          </DisclosureBody>
        ) : null}
      </View>
    );
  }
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

/**
 * A `!` command the user ran (`shellCard`, gx-chat-core's `shell_card`), in the user's bubble
 * (desktop `shell_command_card` in `tool_run.rs`): a header with the terminal glyph, the command, its
 * status and a copy button, opening onto the output alone. It shows in Simple mode too, since it is
 * what the user typed. A running card opens on its output by default and folds like every
 * disclosure, from the header or the rail.
 */
export function ShellCommandCard({ message }: { message: ProjectedMessage }) {
  const { theme } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const card = obj(message.shellCard);
  const hasBody = card?.hasBody === true;
  const [openState, toggle] = useDisclosure(disclosures, `shell:${message.id}`, card?.openByDefault === true);
  const [copied, setCopied] = useState(false);
  const fullCommand = str(card, 'fullCommand');
  const copy = useCallback(() => {
    void Clipboard.setStringAsync(fullCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [fullCommand]);
  const open = hasBody && openState;
  const failed = card?.failed === true;
  const status = str(card, 'status');
  const blocks = (
    [
      ['commandBody', false],
      ['stdout', false],
      ['stderr', true],
    ] as const
  )
    .map(([part, error]) => ({ part, error, content: str(card, part) }))
    .filter(({ content }) => content.trim().length > 0);
  return (
    <View style={styles.shellColumn}>
      <View style={[styles.shellBubble, styles.shellHeaderBubble, { backgroundColor: theme.input }]}>
        <View style={styles.shellHeader}>
          <Pressable
            disabled={!hasBody}
            onPress={toggle}
            accessibilityRole='button'
            accessibilityLabel={`Shell command: ${fullCommand}`}
            accessibilityState={{ expanded: open }}
            style={({ pressed }) => [styles.trigger, styles.shellTrigger, pressed && { backgroundColor: theme.pressed }]}
          >
            <View style={styles.glyphSlot}>
              <Glyph name={toolGlyph('terminal')} size={14} color={theme.muted} />
            </View>
            <Text numberOfLines={1} style={[styles.shellCommand, { color: failed ? theme.error : theme.primary }]}>
              {str(card, 'command')}
            </Text>
            {hasBody ? <Glyph name={open ? 'chevron-down' : 'chevron-right'} size={12} color={theme.muted} /> : null}
            <View style={styles.shellSpacer} />
            {status.length > 0 ? <Text style={[styles.shellStatus, { color: failed ? theme.error : theme.muted }]}>{status}</Text> : null}
          </Pressable>
          {/* No hover on a phone, so the copy button always shows. */}
          <Pressable
            hitSlop={6}
            onPress={copy}
            accessibilityRole='button'
            accessibilityLabel={copied ? 'Copied' : 'Copy command'}
            style={({ pressed }) => [styles.copyAction, pressed && { backgroundColor: theme.pressed }]}
          >
            <Glyph name={copied ? 'check' : 'copy'} size={14} color={theme.muted} />
          </Pressable>
        </View>
      </View>
      {/* The output opens in a bubble of its own below the header, which keeps its collapsed size;
          the header is its toggle, so it carries no rail. */}
      {open && blocks.length > 0 ? (
        <View style={[styles.shellBubble, styles.shellOutputBubble, { backgroundColor: theme.input }]}>
          {blocks.map(({ part, error, content }) => (
            <ToolBody key={part} label={null} content={content} failed={error} copyText='' />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const ToolRow = memo(function ToolRow({
  messageId,
  index,
  tool,
}: {
  messageId: string;
  index: number;
  tool: JsonRecord;
}) {
  const { theme, dispatch, simple } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const key = `tool:${messageId}:${index}`;
  const [open, toggle] = useDisclosure(disclosures, key);
  const hasDetail = tool.hasDetail === true;
  const expanded = open && hasDetail;
  const detail = obj(useRowDetail(key, 'tool', messageId, index, expanded));
  const failed = tool.failed === true;
  const name = str(tool, 'name');
  // Simple mode hides the command preview next to the tool's name.
  const preview = simple ? '' : str(tool, 'preview');
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
      {preview.length > 0 && subagent.length === 0 ? (
        // One line with two runs (desktop `name_and_preview`): side by side, the mono preview sat
        // below the name's baseline; nested runs share one.
        <Text numberOfLines={1} style={styles.nameLine}>
          <Text style={[styles.name, { color: failed ? theme.error : theme.primary }]}>{name}</Text>
          {' '}
          <Text style={[styles.preview, { color: theme.muted }]}>{preview}</Text>
        </Text>
      ) : (
        <Text style={[styles.name, { color: failed ? theme.error : theme.primary }]}>{name}</Text>
      )}
      {hasDetail ? <Glyph name={expanded ? 'chevron-down' : 'chevron-right'} size={12} color={theme.muted} /> : null}
    </Pressable>
  );
  let body = null;
  if (expanded && detail !== null) {
    const input = str(detail, 'input');
    const output = str(detail, 'output');
    const command = tool.glyph === 'terminal';
    // The first block's label row carries the copy button, which copies the whole call (the core's `copyText`).
    const copyText = str(detail, 'copyText');
    const parts = [];
    if (input.length > 0) {
      parts.push(
        <ToolBody key='input' label={command ? 'Command' : output.length > 0 ? 'Input' : null} content={input} failed={false} copyText={copyText} />,
      );
    }
    if (output.length > 0) {
      parts.push(
        <ToolBody key='output' label={tool.hasCall === true ? 'Result' : null} content={output} failed={failed} copyText={parts.length === 0 ? copyText : ''} />,
      );
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

/**
 * One labelled block of a tool's detail: verbatim monospaced text in a height-capped box, selectable
 * with a long press. A non-empty `copyText` puts the copy button for the whole call on its label row
 * (desktop `tool_run.rs`).
 */
function ToolBody({ label, content, failed, copyText }: { label: string | null; content: string; failed: boolean; copyText: string }) {
  const { theme } = useTranscriptEnv();
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void Clipboard.setStringAsync(copyText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [copyText]);
  return (
    <View style={styles.bodyGroup}>
      {label !== null || copyText.length > 0 ? (
        <View style={styles.bodyHeader}>
          <Text numberOfLines={1} style={[styles.bodyLabel, { color: theme.muted }]}>
            {label ?? ''}
          </Text>
          {copyText.length > 0 ? (
            <Pressable
              hitSlop={6}
              onPress={copy}
              accessibilityRole='button'
              accessibilityLabel={copied ? 'Copied' : 'Copy tool call'}
              style={({ pressed }) => [styles.copyAction, pressed && { backgroundColor: theme.pressed }]}
            >
              <Glyph name={copied ? 'check' : 'copy'} size={14} color={theme.muted} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
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
  shellColumn: { alignItems: 'flex-end', gap: 6 },
  shellBubble: { maxWidth: '80%', flexShrink: 1, minWidth: 0, borderRadius: 16 },
  shellHeaderBubble: { paddingHorizontal: 12, paddingVertical: 8 },
  shellOutputBubble: { gap: 4, padding: 2 },
  shellHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 0 },
  shellTrigger: { flex: 1 },
  shellCommand: { fontFamily: MONO_FONT, fontSize: CODE_SIZE, lineHeight: PROSE_LINE, flexShrink: 1, minWidth: 0 },
  shellSpacer: { flexGrow: 1 },
  shellStatus: { fontSize: 12.25, flexShrink: 0 },
  row: { gap: 4, minWidth: 0 },
  trigger: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 4, minWidth: 0, flexShrink: 1 },
  triggerFill: { alignSelf: 'stretch' },
  glyphSlot: { width: 16, marginLeft: 2, height: PROSE_LINE, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: PROSE_SIZE, lineHeight: PROSE_LINE, flexShrink: 0 },
  preview: { fontFamily: MONO_FONT, fontSize: CODE_SIZE, flexShrink: 1, minWidth: 0 },
  nameLine: { fontSize: PROSE_SIZE, lineHeight: PROSE_LINE, flexShrink: 1, minWidth: 0 },
  subagentLine: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  subagentLink: { flexShrink: 1, minWidth: 0 },
  subagentText: { fontSize: PROSE_SIZE, lineHeight: PROSE_LINE },
  foldToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 4 },
  foldLabel: { fontSize: PROSE_SIZE, lineHeight: PROSE_LINE },
  bodyGroup: { gap: 4, minWidth: 0 },
  bodyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minWidth: 0 },
  bodyLabel: { fontSize: 12.25, flexShrink: 1 },
  copyAction: { width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  bodyBox: { maxHeight: 220.75, borderRadius: 6 },
  bodyContent: { paddingHorizontal: 10, paddingVertical: 8 },
  bodyText: { fontFamily: MONO_FONT, fontSize: CODE_SIZE, lineHeight: CODE_LINE },
});
