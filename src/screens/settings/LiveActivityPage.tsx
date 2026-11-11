import { LiveActivityCopy } from '../../copy';
import { DemoCopy } from '../../demo/copy';
import { isDemoMachine } from '../../demo/identity';
import { useMachinesStore } from '../../machines/store';
import { useComputersNeedingUpdate } from '../../notifications/liveActivity';
import { LIVE_ACTIVITY_PUSH_SUPPORTED } from '../../notifications/liveActivityPushStore';
import { useSettingsStore } from '../../settings/store';
import LiveActivityPreview from './LiveActivityPreview';
import { Caption, SectionHeader, SettingsScreenLayout, SettingToggle } from './SettingsControls';

/**
 * Settings › Live Activity (the design's settings; its own page):
 * one switch, on by default (`liveActivityEnabled`). Off ends a running activity at once and starts none.
 * While a computer with agents sends no start times or attention kind, it says which Mac needs an update. iOS only
 * (pages.ts).
 *
 * Under it while it is on, "Keep it updated while locked", off by default (`liveActivityLockedUpdates`): one computer
 * keeps the activity current through Ghostex's push relay while the phone is locked (`liveActivityPush.ts`).
 *
 * A second switch, off by default (`liveActivitySessionNames`): rows lead with the session's name instead of the
 * agent's. It stays on the page while the Live Activity is off, because the Home Screen widgets follow it too.
 */
export default function LiveActivityPage() {
  const enabled = useSettingsStore((state) => state.settings.liveActivityEnabled);
  const showSessionNames = useSettingsStore((state) => state.settings.liveActivitySessionNames);
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
          {LIVE_ACTIVITY_PUSH_SUPPORTED ? (
            <SettingToggle settingKey="liveActivityLockedUpdates" label={LiveActivityCopy.lockedUpdatesToggle} />
          ) : null}
          <Caption>
            {LIVE_ACTIVITY_PUSH_SUPPORTED ? LiveActivityCopy.lockedUpdatesCaption : LiveActivityCopy.freshnessCaption}
          </Caption>
        </>
      ) : (
        <Caption>{LiveActivityCopy.offCaption}</Caption>
      )}
      <SettingToggle settingKey="liveActivitySessionNames" label={LiveActivityCopy.sessionNamesToggle} />
      <Caption>{LiveActivityCopy.sessionNamesCaption}</Caption>
      {enabled ? (
        <>
          <SectionHeader title={LiveActivityCopy.previewTitle} />
          <LiveActivityPreview showSessionNames={showSessionNames} />
        </>
      ) : null}
    </SettingsScreenLayout>
  );
}
