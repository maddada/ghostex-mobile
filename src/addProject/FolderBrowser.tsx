/**
 * Folder browser used by both path screens: a "Browse
 * folders" section with an optional ".." row and one row per directory.
 * Tapping a row REPLACES the input text and never submits; hidden folders are
 * always excluded on mobile.
 */

import type { ReactElement } from 'react';
import { View } from 'react-native';

import { AddProjectCopy } from '../copy';
import { ArrowGlyph, FolderGlyph } from '../components/sessions/icons';
import { GhostexPalette } from '../theme/palette';
import { ListRow, ListSection, MutedText, PendingRow, SectionTitle } from './primitives';
import { appendBrowsePathSegment, canNavigateUp, getBrowseParentPath } from './paths';
import type { DirectoryBrowseState } from './useDirectoryBrowse';

export default function FolderBrowser({
  browse,
  onChangePath,
  path,
}: {
  browse: DirectoryBrowseState;
  onChangePath: (next: string) => void;
  path: string;
}): ReactElement {
  const showUpRow = canNavigateUp(path);
  const rows = browse.entries;

  return (
    <View>
      <SectionTitle>{AddProjectCopy.browseSection}</SectionTitle>
      {browse.firstLoad ? (
        <PendingRow label={AddProjectCopy.browseSection} />
      ) : (
        <ListSection>
          {showUpRow ? (
            <ListRow
              first
              testID="add-project-browse-up"
              title={AddProjectCopy.parentRow}
              icon={<ArrowGlyph size={16} color={GhostexPalette.MUTED} direction="up" />}
              trailing={<View />}
              onPress={() => {
                const parent = getBrowseParentPath(path);
                if (parent !== null) onChangePath(parent);
              }}
            />
          ) : null}
          {rows.map((entry, index) => (
            <ListRow
              key={entry.fullPath}
              first={index === 0 && !showUpRow}
              testID={`add-project-browse-entry-${entry.name}`}
              title={entry.name}
              icon={<FolderGlyph size={16} color={GhostexPalette.MUTED} />}
              onPress={() => onChangePath(appendBrowsePathSegment(path, entry.name))}
            />
          ))}
          {rows.length === 0 && !showUpRow ? (
            <ListRow first disabled title={AddProjectCopy.browseEmpty} onPress={() => undefined} />
          ) : null}
        </ListSection>
      )}
      {rows.length === 0 && showUpRow && !browse.pending ? (
        <MutedText>{AddProjectCopy.browseEmpty}</MutedText>
      ) : null}
    </View>
  );
}
