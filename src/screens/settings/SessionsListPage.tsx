import { hidesProjectsWithoutSessions } from '../../components/sessions/drawerModel';
import { useInventoryStore } from '../../inventory/store';
import { useMachinesStore } from '../../machines/store';
import { useSettingsStore, type SessionsListLayout } from '../../settings/store';
import { SettingsSection } from './SectionBoundary';
import { Caption, SectionHeader, SegmentedRow, SettingsScreenLayout, ToggleRow } from './SettingsControls';

const LAYOUT_OPTIONS: { value: SessionsListLayout; label: string }[] = [
  { value: 'unified', label: 'Unified' },
  { value: 'project', label: 'Project' },
];

/**
 * Settings › Sessions list: the phone's own layout, apart from the computer's Sidebar setting
 * (`sessionsListLayout` in settings/store.ts holds the user's decision).
 */
export default function SessionsListPage() {
  const layout = useSettingsStore((state) => state.settings.sessionsListLayout) ?? 'project';
  const groupByProject = useSettingsStore((state) => state.settings.sessionsListGroupByProject);
  const workingSection = useSettingsStore((state) => state.settings.sessionsListWorkingSection);
  const ownHideProjects = useSettingsStore((state) => state.settings.sessionsListHideProjectsWithoutSessions);
  const setSetting = useSettingsStore((state) => state.setSetting);
  const selectedSummary = useInventoryStore((state) => {
    const machineId = useMachinesStore.getState().selectedMachineId;
    return machineId === null ? null : (state.inventoriesByMachineId[machineId]?.summary ?? null);
  });
  const hideProjects = hidesProjectsWithoutSessions(ownHideProjects, selectedSummary);

  return (
    <SettingsScreenLayout>
      <SettingsSection name="settings:sessions-list:layout">
        <SectionHeader title="Sessions list" />
        <SegmentedRow
          label="Sessions list layout"
          options={LAYOUT_OPTIONS}
          value={layout}
          onChange={(next) => setSetting('sessionsListLayout', next)}
        />
        <Caption>
          {layout === 'unified'
            ? "Every computer's sessions in one list. The filter narrows it by computer, Space or project."
            : 'One computer at a time: pick it from the tabs, and its sessions show under their projects.'}
        </Caption>
        {layout === 'project' ? (
          <>
            <ToggleRow
              label="Hide projects without sessions"
              detail="Project only"
              value={hideProjects}
              onValueChange={(next) => setSetting('sessionsListHideProjectsWithoutSessions', next)}
            />
            <Caption>
              Leaves projects with no sessions out of the list, whatever state a session is in. A Show all projects row
              at the end brings them back. Starts as the computer has it; changing it here never changes the computer.
            </Caption>
          </>
        ) : null}
        {layout === 'unified' ? (
          <>
            <ToggleRow
              label="Group by project"
              detail="Unified only"
              value={groupByProject}
              onValueChange={(next) => setSetting('sessionsListGroupByProject', next)}
            />
            <ToggleRow
              label="Show Moving section"
              detail="Unified only"
              value={workingSection}
              onValueChange={(next) => setSetting('sessionsListWorkingSection', next)}
            />
            <Caption>Sessions whose agent is working fold into the Moving section while the switch is on.</Caption>
          </>
        ) : null}
      </SettingsSection>
    </SettingsScreenLayout>
  );
}
