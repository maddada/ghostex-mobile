/**
 * The larger table preview over the chat. Port of desktop `table_preview/`: a "Table" sheet with
 * every cell wrapping inside a column up to 480pt wide, scrolling sideways only when the table is
 * still wider than the screen, and Copy as Markdown / CSV. The table source is the Markdown the
 * transcript's table carried; `tableCsv` is desktop's `table_csv` (React's `sessionChatTableToCsv`).
 */

import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glyph } from './icons';
import { useChatOverlayStore } from './overlayStore';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';

export function TablePreview() {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const preview = useChatOverlayStore((state) => state.tablePreview);
  const insets = useSafeAreaInsets();
  const [copied, setCopied] = useState<string | null>(null);
  if (preview === null) return null;
  const close = () => {
    setCopied(null);
    useChatOverlayStore.setState({ tablePreview: null });
  };
  const rows = tableRows(preview.source);
  const [head, ...rest] = rows;
  const columns = Math.max(0, ...rows.map((row) => row.length));
  // Each column is as wide as its longest cell needs (estimated from the 14pt glyph width), up to
  // desktop's 480pt cap, so short columns stay narrow and long ones wrap.
  const widths = Array.from({ length: columns }, (_, column) =>
    Math.min(480, Math.max(72, Math.max(0, ...rows.map((row) => tableCellText(row[column] ?? '').length)) * 7.6 + 22))
  );
  const copy = (label: string, text: string) => {
    void Clipboard.setStringAsync(text).then(() => setCopied(label));
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={[styles.backdrop, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Table</Text>
            <View style={styles.headerActions}>
              <CopyAction label={copied === 'MD' ? 'Copied' : 'MD'} onPress={() => copy('MD', preview.source)} />
              <CopyAction label={copied === 'CSV' ? 'Copied' : 'CSV'} onPress={() => copy('CSV', tableCsv(preview.source))} />
              <Pressable accessibilityRole="button" accessibilityLabel="Close table preview" hitSlop={8} onPress={close} style={styles.close}>
                <Glyph name="x" size={16} color={P.muted} />
              </Pressable>
            </View>
          </View>
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <ScrollView horizontal nestedScrollEnabled>
              <View style={styles.table}>
                {head !== undefined ? <TableRow cells={head} widths={widths} header /> : null}
                {rest.map((row, index) => (
                  <TableRow key={index} cells={row} widths={widths} />
                ))}
              </View>
            </ScrollView>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function TableRow({ cells, widths, header }: { cells: string[]; widths: number[]; header?: boolean }) {
  const styles = useStyles();
  return (
    <View style={[styles.row, header && styles.headerRow]}>
      {widths.map((width, index) => (
        <View key={index} style={[styles.cell, index === 0 && styles.firstCell, { width }]}>
          <Text style={[styles.cellText, header && styles.headerText]} selectable>
            {tableCellText(cells[index] ?? '')}
          </Text>
        </View>
      ))}
    </View>
  );
}

function CopyAction({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Copy table as ${label}`}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.copy, pressed && { backgroundColor: P.border }]}
    >
      <Text style={styles.copyLabel}>{label}</Text>
    </Pressable>
  );
}

/** The table's content rows (the delimiter row dropped), each split into cells. */
function tableRows(source: string): string[][] {
  return source
    .split('\n')
    .filter((line) => line.includes('|') && !isTableDelimiterRow(line))
    .map(tableRowCells);
}

function tableRowCells(line: string): string[] {
  const body = line.trim().replace(/^\|+|\|+$/g, '');
  const cells = [''];
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === '\\' && body[index + 1] === '|') {
      cells[cells.length - 1] += '|';
      index += 1;
    } else if (character === '|') {
      cells.push('');
    } else {
      cells[cells.length - 1] += character;
    }
  }
  return cells.map((cell) => cell.trim());
}

/** A cell as it reads: bold marks, code ticks and link targets dropped. */
function tableCellText(cell: string): string {
  return cell.replaceAll('**', '').replaceAll('`', '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}

function isTableDelimiterRow(line: string): boolean {
  const body = line.trim();
  return body.length > 0 && /^[|\-: ]+$/.test(body) && body.includes('-');
}

export function tableCsv(source: string): string {
  return tableRows(source)
    .map((cells) =>
      cells
        .map((cell) => {
          const value = tableCellText(cell);
          return /["\n,]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
        })
        .join(',')
    )
    .join('\n');
}

const useStyles = themedStyles((P) => ({
  backdrop: {
    flex: 1,
    paddingHorizontal: 12,
    backgroundColor: P.modalBackdrop,
  },
  card: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: {
    color: P.foreground,
    fontSize: 18,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  copy: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  copyLabel: {
    color: P.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  close: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  table: {
    borderWidth: 1,
    borderColor: P.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: P.border,
  },
  headerRow: {
    borderTopWidth: 0,
    backgroundColor: P.input,
  },
  cell: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderLeftWidth: 1,
    borderLeftColor: P.border,
  },
  firstCell: {
    borderLeftWidth: 0,
  },
  cellText: {
    color: P.prose,
    fontSize: 14,
    lineHeight: 21,
  },
  headerText: {
    color: P.foreground,
    fontWeight: '600',
  },
}));
