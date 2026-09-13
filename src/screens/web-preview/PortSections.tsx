import { useMemo, useState } from 'react';
import { Image, Pressable, Text, TextInput, View } from 'react-native';

import { WorldGlyph } from '../../components/sessions/icons';
import { GhostexPalette } from '../../theme/palette';
import { groupPorts, type PortListRow, type PortSectionId } from '../../webPreview/portSections';
import type { RemoteListeningPort } from '../../webPreview/ports';
import { styles } from './styles';

export function PortSections({ ports, onOpen }: {
  ports: RemoteListeningPort[];
  onOpen: (entry: RemoteListeningPort) => void;
}) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<PortSectionId>>(() => new Set(['services', 'other']));
  const [searchCollapsed, setSearchCollapsed] = useState<Set<PortSectionId>>(() => new Set());
  const sections = useMemo(() => groupPorts(ports, query), [ports, query]);
  return (
    <View style={styles.portSections}>
      <TextInput
        value={query}
        onChangeText={(value) => { setQuery(value); setSearchCollapsed(new Set()); }}
        style={styles.portSearch}
        placeholder='Find a page, process, or port'
        placeholderTextColor={GhostexPalette.MUTED}
        accessibilityLabel='Search pages and ports'
        autoCapitalize='none'
        autoCorrect={false}
        clearButtonMode='while-editing'
      />
      {sections.length === 0 ? <Text style={styles.emptyRow}>No matching pages or ports.</Text> : null}
      {sections.map((section) => {
        const searching = query.trim().length > 0;
        const expanded = !(searching ? searchCollapsed : collapsed).has(section.id);
        return (
          <View key={section.id} style={styles.listSection}>
            <Pressable
              accessibilityRole='button'
              accessibilityLabel={`${section.title}, ${section.rows.length}`}
              accessibilityState={{ expanded }}
              style={styles.portSectionHeader}
              onPress={() => {
                const update = searching ? setSearchCollapsed : setCollapsed;
                update((current) => {
                  const next = new Set(current);
                  if (expanded) next.add(section.id);
                  else next.delete(section.id);
                  return next;
                });
              }}
            >
              <Text style={styles.sectionChevron}>{expanded ? '▾' : '▸'}</Text>
              <View style={styles.portRowBody}>
                <Text style={styles.portSectionTitle}>{section.title}</Text>
                <Text style={styles.portRowDescription}>{section.description}</Text>
              </View>
              <Text style={styles.portSectionCount}>{section.rows.length}</Text>
            </Pressable>
            {expanded ? section.rows.map((row) => <PortRow key={row.entry.port} row={row} onOpen={onOpen} />) : null}
          </View>
        );
      })}
    </View>
  );
}

function PortRow({ row, onOpen }: { row: PortListRow; onOpen: (entry: RemoteListeningPort) => void }) {
  const [failedIcon, setFailedIcon] = useState<string | null>(null);
  const icon = row.entry.web?.faviconDataUrl;
  const process = [row.entry.command, row.entry.pid === null ? null : `PID ${row.entry.pid}`].filter(Boolean).join(' · ');
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={`Open ${row.title}, ${row.address}`}
      onPress={() => onOpen(row.entry)}
      style={({ pressed }) => [styles.portRow, styles.portRowDivided, pressed && styles.portRowPressed]}
    >
      <View style={styles.portRowIcon}>
        {icon && icon !== failedIcon ? (
          <Image source={{ uri: icon }} style={styles.portFavicon} onError={() => setFailedIcon(icon)} />
        ) : /storybook/i.test(row.title) ? (
          <Text style={styles.storybookIcon}>S</Text>
        ) : <WorldGlyph size={16} color={GhostexPalette.MUTED} />}
      </View>
      <View style={styles.portRowBody}>
        <Text numberOfLines={2} style={styles.portPageTitle}>{row.title}</Text>
        <Text numberOfLines={1} style={styles.portAddress}>{row.address}</Text>
        <Text numberOfLines={2} style={styles.portRowDescription}>{row.description}</Text>
        {process ? <Text numberOfLines={1} style={styles.portRowDescription}>{process}</Text> : null}
      </View>
    </Pressable>
  );
}
