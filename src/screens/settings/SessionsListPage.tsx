import { SessionGroupsCopy } from '../../copy';
import { useInventoryStore } from '../../inventory/store';
import { useMachinesStore } from '../../machines/store';
import { useSettingsStore } from '../../settings/store';
import { setGroupSessionsByTags } from '../../settingsSync/groupingSwitch';
import { setSidebarSetting } from '../../settingsSync/settingsSync';
import { useSidebarOrganization, type SidebarOrganization } from '../../settingsSync/sidebarOrganization';
import { useSyncedEntriesStore } from '../../settingsSync/syncedEntries';
import { SettingsSection } from './SectionBoundary';
import { BoolChoiceRow, Caption, SectionHeader, SegmentedRow, SettingsScreenLayout, ToggleRow } from './SettingsControls';
import { SessionTagsSection } from './SessionTagsSection';

const VIEW_OPTIONS: { value: SidebarOrganization['sidebarView']; label: string }[] = [
  { value: 'project', label: 'Project sidebar' },
  { value: 'unified', label: 'Unified sidebar' },
];

const PINNED_ORDER_OPTIONS: { value: SidebarOrganization['pinnedSessionOrder']; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'recent', label: 'Most recently updated' },
];

const SESSION_ORDER_OPTIONS: { value: SidebarOrganization['unifiedSessionOrder']; label: string }[] = [
  { value: 'recent', label: 'Recent' },
  { value: 'alphabetical', label: 'A to Z' },
  { value: 'created', label: 'Created' },
];

/**
 * Settings › Sidebar & Sessions: the desktop's Sidebar organization settings, under the desktop's names and in its
 * sections (packages/settings-catalog general/sidebar.rs, layout.rs), synced with the computers
 * (settingsSync/sidebarOrganization.ts). How the list looks stays the phone's own (Theme, Advanced).
 */
export default function SessionsListPage() {
  const selectedSummary = useInventoryStore((state) => {
    const machineId = useMachinesStore.getState().selectedMachineId;
    return machineId === null ? null : (state.inventoriesByMachineId[machineId]?.serverSummary ?? null);
  });
  const organization = useSidebarOrganization(selectedSummary);
  const syncing = useSyncedEntriesStore((state) =>
    Object.values(state.categoriesByMachine).some((categories) => categories.includes('spaces')),
  );
  const carrying = useSettingsStore((state) => state.settings.settingsSyncThroughPhone);
  const unified = organization.sidebarView === 'unified';
  const toggle = (key: keyof SidebarOrganization, label: string, detail?: string) => (
    <ToggleRow
      label={label}
      detail={detail}
      value={organization[key] === true}
      onValueChange={(next) => setSidebarSetting(key, next as never)}
    />
  );

  return (
    <SettingsScreenLayout>
      <SettingsSection name="settings:sessions-list:sidebar">
        <SectionHeader title="Layout" />
        <SegmentedRow
          label="Sidebar"
          options={VIEW_OPTIONS}
          value={organization.sidebarView}
          onChange={(next) => setSidebarSetting('sidebarView', next)}
        />
        <Caption>
          {unified
            ? 'Every session in one list, with the ones that need you on top.'
            : 'Each project with its sessions under it.'}{' '}
          Both show every connected computer together unless Computers is set to A tab each.
        </Caption>
        <BoolChoiceRow
          label="Computers"
          choices={[
            ['One list', false],
            ['A tab each', true],
          ]}
          value={organization.sidebarSeparateByMachine === true}
          onChange={(next) => setSidebarSetting('sidebarSeparateByMachine', next as never)}
        />
        <Caption>A tab each: one computer at a time, each with its own tab, project list and Spaces.</Caption>
        {organization.sidebarSeparateByMachine
          ? null
          : toggle(
              'sidebarMergeRepositoryCopies',
              'Merge copies of the same repository',
              'Two folders of one computer that are copies of one repository show as one project.',
            )}
        {unified ? (
          <>
            <ToggleRow
              label={SessionGroupsCopy.switchLabel}
              detail={SessionGroupsCopy.switchDetail}
              value={organization.groupSessionsByTags}
              onValueChange={(next) => setGroupSessionsByTags(next, selectedSummary)}
            />
            {toggle(
              'unifiedWorkingSection',
              'Moving section',
              'Sessions that are working fold into a Moving section at the bottom until they need you.',
            )}
            {organization.groupSessionsByTags ? <Caption>{SessionGroupsCopy.movingKept}</Caption> : null}
            {toggle(
              'unifiedGroupByProject',
              'Group by project',
              "Every computer's sessions of one repository under one header.",
            )}
            {/* CDXC:Sidebar 2026-11-17 DECISION (packages/gx-core/src/unified_sidebar/build.rs `unified_session_cmp`):
                Recent activity by default; synced with the computers. */}
            <SegmentedRow
              label="Session order"
              options={SESSION_ORDER_OPTIONS}
              value={organization.unifiedSessionOrder}
              onChange={(next) => setSidebarSetting('unifiedSessionOrder', next)}
            />
            <Caption>
              Session order: recent activity, alphabetical by title, or newest first. A to Z and Created keep a
              session in place when it works or finishes.
            </Caption>
          </>
        ) : (
          <>
            {toggle(
              'sidebarHideProjectsWithoutSessions',
              'Hide projects without sessions',
              'A Show all projects row at the end brings them back.',
            )}
            <BoolChoiceRow
              label="Worktree sessions"
              choices={[
                ['In their repository', true],
                ['Own project', false],
              ]}
              value={organization.worktreeSessionsInProject === true}
              onChange={(next) => setSidebarSetting('worktreeSessionsInProject', next as never)}
            />
            <Caption>In their repository: listed under the repository's project, with the worktree's branch on the row.</Caption>
            {/* CDXC:RemoteMachines 2026-11-15 DECISION (packages/gx-core/src/sidebar_view/merged.rs): off by default;
                the Unified list always leaves a computer that isn't connected out, and Separate by machine gives each its
                own tab. */}
            {organization.sidebarSeparateByMachine
              ? null
              : toggle(
                  'sidebarHideDisconnectedMachines',
                  "Hide sessions and projects from computers that aren't connected",
                  'They come back when the computer reconnects.',
                )}
            {toggle(
              'groupWorkingSessions',
              'Group working sessions',
              'Working sessions move into a folded Working section under their project.',
            )}
          </>
        )}
        <SegmentedRow
          label="Pinned order"
          options={PINNED_ORDER_OPTIONS}
          value={organization.pinnedSessionOrder}
          onChange={(next) => setSidebarSetting('pinnedSessionOrder', next)}
        />
        <Caption>Pinned order: the order you arranged them in, or the one that came back to you last first.</Caption>
        {toggle('enableSessionParking', 'Enable session parking', 'Deferred sessions move into a folded Parked section.')}
      </SettingsSection>
      <SettingsSection name="settings:sessions-list:spaces">
        <SectionHeader title="Spaces" />
        {toggle('sidebarSpacesEnabled', 'Spaces', 'Group projects into Spaces and switch between them from the chips.')}
        {/* CDXC:Settings 2026-11-14 DECISION (AGENTS.md, Q3107): both only matter with Spaces on
            (spaces/spaceFilter.ts), so they show only then. */}
        {organization.sidebarSpacesEnabled ? (
          <>
            {toggle(
              'sidebarActiveProjects',
              'Active projects',
              'A star before your Spaces lists the projects you are working on from every Space.',
            )}
            {toggle('chiefShowOnAllSpaces', 'Show Main Hub on all Spaces', 'Main Hub stays at the top of every Space.')}
          </>
        ) : null}
      </SettingsSection>
      <SessionTagsSection
        items={organization.sidebarSessionTagListItems}
        summary={selectedSummary}
        grouping={unified && organization.groupSessionsByTags}
      />
      <SettingsSection name="settings:sessions-list:sync">
        <Caption>
          {!carrying
            ? 'Carry settings between computers is off (Settings › Sync): these stay as they are on this phone.'
            : syncing
              ? 'These follow Sidebar organization sync: a change here reaches your computers, and a change there shows here.'
              : 'None of your computers syncs Sidebar organization yet: changes here stay on this phone. Turn on Sidebar organization in Settings › Sync on a computer.'}
        </Caption>
      </SettingsSection>
    </SettingsScreenLayout>
  );
}
