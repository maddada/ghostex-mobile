import { LiveActivityCopy } from '../../copy';
import { DemoCopy } from '../../demo/copy';
import { isDemoMachine } from '../../demo/identity';
import { useMachinesStore } from '../../machines/store';
import { useComputersNeedingUpdate } from '../../notifications/liveActivity';
import { useSettingsStore } from '../../settings/store';
import LiveActivityPreview from './LiveActivityPreview';
import { Caption, SectionHeader, SettingsScreenLayout, SettingToggle } from './SettingsControls';

/**
 * Settings › Live Activity (the design's settings; its own page):
 * one switch, on by default (`liveActivityEnabled`). Off ends a running activity at once and starts none.
 * While a computer with agents sends no start times or attention kind, it says which Mac needs an update. iOS only
 * (pages.ts).
 */
export default function LiveActivityPage() {
  const enabled = useSettingsStore((state) => state.settings.liveActivityEnabled);
  const outdated = useComputersNeedingUpdate();
  const demoOn = useMachinesStore((state) => state.machines.some((machine) => isDemoMachine(machine)));
  return (
    <SettingsScreenLayout>
      <SettingToggle settingKey="liveActivityEnabled" label={LiveActivityCopy.toggle} />
      {demoOn ? <Caption>{DemoCopy.liveActivityNote}</Caption> : null}
      {enabled ? (
        <>
          {outdated.length > 0 ? <Caption>{LiveActivityCopy.needsUpdate(outdated)}</Caption> : null}
          <Caption>{LiveActivityCopy.onCaption}</Caption>
          <Caption>{LiveActivityCopy.freshnessCaption}</Caption>
          <SectionHeader title={LiveActivityCopy.previewTitle} />
          <LiveActivityPreview />
        </>
      ) : (
        <Caption>{LiveActivityCopy.offCaption}</Caption>
      )}
    </SettingsScreenLayout>
  );
}
