/**
 * Settings › Voice: Dictate and the voice agent on one computer, picked at the top, and the
 * phone's own microphone at the bottom. Dictate's engine (a local model, OpenAI, xAI or Hex 3), its
 * models, language, dictionary, filler removal and AI polish live on that computer and are read
 * and saved through its gxserver (`voice/dictateSettings.ts`); so is the voice agent's call mode.
 *
 * CDXC:VoiceMode 2026-11-05 DECISION: User (Q1275): "Settings › Voice, with a computer picker at the top". Each paired computer has its own Dictate engine, since its gxserver transcribes; the microphone stays a phone setting. The page replaces Settings › Voice agent, whose call mode is now its Voice agent section.
 */

import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import ActionSheet from '../../components/common/ActionSheet';
import { useInventoryStore } from '../../inventory/store';
import { jobActive, runRowAction, useMachineToolsStore } from '../../machines/machineTools';
import { machineDisplayLabel, type MachineRecord } from '../../machines/store';
import type { RootStackParamList } from '../../navigation/types';
import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';
import { useAppearance } from '../../theme/useAppearance';
import {
  readComputerCallMode,
  saveComputerCallMode,
  VOICE_CALL_MODE_NOTE,
  VOICE_CALL_MODES,
  type VoiceCallMode,
} from '../../voice/conversation';
import {
  dictateEngines,
  dictionarySummary,
  downloadPercent,
  engineCaption,
  formatBytes,
  languageLabel,
  modelDetail,
  modelSpeaks,
  type DictateEngineId,
  type SpeechModel,
} from '../../voice/dictateModel';
import {
  cancelModelDownload,
  changeDictate,
  chooseVoiceComputer,
  downloadModel,
  loadDictate,
  readDictateEngine,
  removeModel,
  stopDictatePolling,
  useDictateStore,
} from '../../voice/dictateSettings';
import { voiceAgentOnIn } from '../../voice/featureSwitch';
import { SettingsSection } from './SectionBoundary';
import {
  Caption,
  ChoiceRow,
  LinkRow,
  SectionHeader,
  SegmentedRow,
  SettingsScreenLayout,
  ToggleRow,
  useSettingsStyles,
} from './SettingsControls';
import { computerName, useVoiceComputer } from './voiceComputer';
import { isDemoMachine } from '../../demo/identity';
import { DemoCopy } from '../../demo/copy';

export default function VoicePage() {
  const { machine, machines } = useVoiceComputer();
  const loadedFor = useDictateStore((state) => state.loadedFor);
  const machineId = machine?.id ?? null;

  // Read fresh each time the page opens or another computer is picked (not when the record's
  // other fields change, such as its last connection time).
  useEffect(() => {
    if (machine === null || isDemoMachine(machine)) return;
    chooseVoiceComputer(machine.id);
    void loadDictate(machine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineId]);
  useEffect(() => stopDictatePolling, []);

  if (machine === null) {
    return (
      <SettingsScreenLayout>
        <Caption>Connect a computer first: Dictate and the voice agent run on your computer.</Caption>
        <PhoneSection />
      </SettingsScreenLayout>
    );
  }
  if (isDemoMachine(machine)) {
    return (
      <SettingsScreenLayout>
        {machines.length > 1 ? <ComputerPicker machine={machine} machines={machines} /> : null}
        <Caption>{DemoCopy.voiceNote}</Caption>
      </SettingsScreenLayout>
    );
  }
  return (
    <SettingsScreenLayout>
      <ComputerPicker machine={machine} machines={machines} />
      {loadedFor === machine.id ? <DictateSection machine={machine} /> : null}
      <CallModeSection machine={machine} />
      <PhoneSection />
    </SettingsScreenLayout>
  );
}

/** The card at the top: which computer the settings below are saved on; a tap picks another. */
function ComputerPicker({ machine, machines }: { machine: MachineRecord; machines: MachineRecord[] }) {
  const styles = useSettingsStyles();
  const appearance = useAppearance();
  const [open, setOpen] = useState(false);
  const [engines, setEngines] = useState<Record<string, string>>({});
  const several = machines.length > 1;

  // The sheet says what dictates on each computer, asked when it opens.
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    for (const entry of machines) {
      void readDictateEngine(entry).then((engine) => {
        if (live)
          setEngines((known) => ({ ...known, [entry.id]: engine === null ? "Couldn't reach it" : `Dictate: ${engine.label}` }));
      });
    }
    return () => {
      live = false;
    };
  }, [open, machines]);

  return (
    <SettingsSection name="settings:voice:computer">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Voice settings for ${machineDisplayLabel(machine)}`}
        accessibilityHint={several ? 'Picks another computer' : undefined}
        disabled={!several}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.row, local.computer, pressed && styles.rowPressed]}
      >
        <View style={styles.linkText}>
          <Text style={styles.linkTitle}>{machineDisplayLabel(machine)}</Text>
          <Text style={styles.linkDescription}>The settings below are saved on this computer</Text>
        </View>
        {several ? <Text style={[styles.chevron, { color: appearance.muted }]}>⌄</Text> : null}
      </Pressable>
      <ActionSheet
        visible={open}
        title="Change voice settings on"
        subtitle="Dictating in a chat always uses the computer that runs that chat."
        items={machines.map((entry) => ({
          key: entry.id,
          label: `${entry.id === machine.id ? '✓ ' : ''}${machineDisplayLabel(entry)}`,
          detail: engines[entry.id] ?? 'Dictate: asking…',
          onPress: () => {
            setOpen(false);
            chooseVoiceComputer(entry.id);
          },
        }))}
        onClose={() => setOpen(false)}
      />
    </SettingsSection>
  );
}

/** Dictate on the picked computer: engine, models, language, dictionary and clean-up. */
function DictateSection({ machine }: { machine: MachineRecord }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const overview = useDictateStore((state) => state.overview);
  const status = useDictateStore((state) => state.status);
  const problem = useDictateStore((state) => state.problem);
  const name = computerName(machine);

  if (overview === null) {
    return (
      <SettingsSection name="settings:voice:dictate">
        <SectionHeader title={`Dictate on ${name}`} />
        {status === 'loading' ? <Caption>{`Reading Dictate's settings from ${name}…`}</Caption> : null}
        {status === 'outdated' ? (
          <Caption>{`Ghostex on ${name} is too old to change Dictate from the phone. Update Ghostex on that computer.`}</Caption>
        ) : null}
        {status === 'failed' ? (
          <>
            <Caption>{`Couldn't read Dictate's settings from ${name}: ${problem ?? 'no answer'}`}</Caption>
            <LinkRow title="Try again" onPress={() => void loadDictate(machine)} />
          </>
        ) : null}
      </SettingsSection>
    );
  }

  const { settings } = overview;
  const inUse = overview.models.find((model) => model.id === settings.localModel);
  const chooseEngine = (engine: DictateEngineId) => {
    void changeDictate(machine, { engine });
    // As drawn in the mockup: picking Local starts the chosen model's download right away.
    if (engine === 'local' && inUse !== undefined && (inUse.state === 'notDownloaded' || inUse.state === 'failed'))
      void downloadModel(machine, inUse.id);
  };

  return (
    <SettingsSection name="settings:voice:dictate">
      <SectionHeader title={`Dictate on ${name}`} />
      <SegmentedRow
        label="Dictate engine"
        options={dictateEngines(overview)}
        value={settings.engine}
        onChange={chooseEngine}
      />
      <Caption>{engineCaption(overview, name)}</Caption>
      {settings.engine === 'hex' ? <HexBlock machine={machine} /> : null}
      {settings.engine === 'local' ? (
        <>
          {overview.models.map((model) => (
            <ModelRow key={model.id} machine={machine} model={model} />
          ))}
          <Caption>
            {`Models are stored on ${name} and take ${formatBytes(overview.modelsDiskBytes)} there now. ${overview.models
              .map((model) => model.attribution)
              .filter((line) => line !== undefined && line.length > 0)
              .join('. ')}.`}
          </Caption>
        </>
      ) : null}
      <LinkRow
        title="Language"
        description={languageLabel(overview.languages, settings.language)}
        onPress={() => navigation.navigate('SettingsPage', { page: 'dictateLanguage' })}
      />
      {settings.engine === 'local' && inUse !== undefined && !modelSpeaks(inUse, settings.language) ? (
        <Caption>{`${inUse.shortTitle} doesn't know ${languageLabel(overview.languages, settings.language)}. Pick a Whisper model, or another language.`}</Caption>
      ) : null}
      <LinkRow
        title="Dictionary"
        description={dictionarySummary(settings)}
        onPress={() => navigation.navigate('SettingsPage', { page: 'dictateDictionary' })}
      />
      <ToggleRow
        label="Remove filler words"
        detail="Drops um, uh and repeated words."
        value={settings.removeFillers}
        onValueChange={(removeFillers) => void changeDictate(machine, { removeFillers })}
      />
      <ToggleRow
        label="AI polish"
        detail={
          overview.polishAvailable
            ? 'Claude Sonnet 5.5 fixes punctuation and obvious slips after the words arrive. Skip it while it runs.'
            : `Needs Claude Code signed in on ${name}. Until then the text arrives unpolished.`
        }
        value={settings.polish.enabled}
        onValueChange={(enabled) => void changeDictate(machine, { polish: { ...settings.polish, enabled } })}
      />
      {problem !== null ? <Caption>{problem}</Caption> : null}
    </SettingsSection>
  );
}

/**
 * Hex on the picked computer (`hex` in its Dictate settings): Install Hex there when Hex 3 isn't
 * installed (the Edit machine screen's install, only on a tap), Check again while Hex isn't
 * running, and the models Hex has ready to pick from.
 */
function HexBlock({ machine }: { machine: MachineRecord }) {
  const hex = useDictateStore((state) => state.overview?.hex);
  const hexModel = useDictateStore((state) => state.overview?.settings.hexModel ?? null);
  const tools = useMachineToolsStore((state) => state.byMachineId[machine.id]);
  const name = computerName(machine);
  const hexTool = tools?.tools.data?.find((tool) => tool.id === 'hex');
  const installing = tools?.starting['tool:hex'] === true || jobActive(hexTool?.job);
  const failed = tools?.failed['tool:hex'] ?? (hexTool?.job?.status === 'failed' ? hexTool.job.error : null);
  const wasInstalling = useRef(false);

  // When the install ends, read Hex's state again.
  useEffect(() => {
    if (wasInstalling.current && !installing) void loadDictate(machine, true);
    wasInstalling.current = installing;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installing]);

  if (hex === undefined) return null;
  // The install is followed until it ends (machineTools.ts), then Hex is read again above.
  const install = () => void runRowAction(machine, 'tool:hex', { label: 'Install', operation: 'install' });
  return (
    <>
      {/* The engine caption above says where Hex stands (hexCaption). */}
      {installing ? <Caption>{`Installing Hex on ${name}…`}</Caption> : null}
      {hex.state === 'notInstalled' && !installing ? (
        <LinkRow
          title={hex.olderVersion ? 'Install Hex 3' : 'Install Hex'}
          description={`Installs it on ${name}. Hex then downloads a speech model the first time it runs there.`}
          onPress={install}
        />
      ) : null}
      {hex.state === 'ready'
        ? hex.models.map((model) => (
            <ChoiceRow
              key={model.id}
              label={model.name}
              selected={(hex.model ?? hexModel) === model.id}
              onPress={() => void changeDictate(machine, { hexModel: model.id })}
            />
          ))
        : null}
      {!installing ? (
        <LinkRow title="Check again" description={`Asks Hex on ${name} again.`} onPress={() => void loadDictate(machine, true)} />
      ) : null}
      {failed ? <Caption>{`Hex wasn't installed: ${failed}`}</Caption> : null}
    </>
  );
}

/** One local model: its size and languages, and Download, Cancel, Use or Remove. */
function ModelRow({ machine, model }: { machine: MachineRecord; model: SpeechModel }) {
  const styles = useSettingsStyles();
  const appearance = useAppearance();
  const percent = downloadPercent(model);
  const moving = model.state === 'downloading' || model.state === 'preparing';
  const ready = model.state === 'ready';
  const name = computerName(machine);

  const remove = () =>
    Alert.alert(
      `Remove ${model.shortTitle}?`,
      `It frees ${formatBytes(model.diskBytes)} on ${name}.${model.inUse ? ' Dictate needs a model again before it can transcribe.' : ''} You can download it again any time.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void removeModel(machine, model.id) },
      ],
    );

  const button = (label: string, onPress: () => void, accessibilityLabel?: string) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${label} ${model.shortTitle}`}
      onPress={onPress}
      style={({ pressed }) => [
        local.button,
        { backgroundColor: pressed ? appearance.neutralFillPressed : appearance.neutralFill },
      ]}
    >
      <Text style={[local.buttonText, { color: appearance.foreground }]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={[styles.card, model.inUse && ready ? local.inUse : null]}>
      <View style={local.modelTop}>
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected: model.inUse, disabled: !ready }}
          disabled={!ready || model.inUse}
          onPress={() => void changeDictate(machine, { localModel: model.id })}
          style={styles.rowText}
        >
          <Text style={styles.cardLabel}>{model.title}</Text>
          <Text style={styles.linkDescription}>{modelDetail(model)}</Text>
        </Pressable>
        <View style={local.actions}>
          {model.state === 'notDownloaded' || model.state === 'failed'
            ? button(model.state === 'failed' ? 'Retry' : 'Download', () => void downloadModel(machine, model.id))
            : null}
          {model.state === 'downloading'
            ? button('Cancel', () => void cancelModelDownload(machine, model.id), `Stop downloading ${model.shortTitle}`)
            : null}
          {ready && !model.inUse ? button('Use', () => void changeDictate(machine, { localModel: model.id })) : null}
          {ready && model.inUse ? (
            <Text style={[local.check, { color: GhostexPalette.ACCENT }]} accessibilityLabel="In use">
              ✓
            </Text>
          ) : null}
          {ready ? button('Remove', remove) : null}
        </View>
      </View>
      {moving ? (
        <View style={[local.track, { backgroundColor: appearance.control }]}>
          <View style={[local.fill, { width: `${percent ?? 0}%` }]} />
        </View>
      ) : null}
      {model.state === 'failed' && model.download?.error ? (
        <Text style={styles.linkDescription}>{model.download.error}</Text>
      ) : null}
    </View>
  );
}

/** The voice agent's call mode on the picked computer (the old Settings › Voice agent). */
function CallModeSection({ machine }: { machine: MachineRecord }) {
  // The computer's voice agent switch (Settings > Extensions there); its call mode means nothing while it is off.
  const switchedOn = useInventoryStore((state) => voiceAgentOnIn(state.inventoriesByMachineId[machine.id]?.summary));
  const [mode, setMode] = useState<VoiceCallMode | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const name = computerName(machine);

  useEffect(() => {
    let live = true;
    setMode(null);
    setProblem(null);
    void readComputerCallMode(machine).then((answer) => {
      if (!live) return;
      if ('mode' in answer) setMode(answer.mode);
      else setProblem(answer.error);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine.id]);

  const choose = (next: VoiceCallMode) => {
    if (next === mode) return;
    const previous = mode;
    setMode(next);
    setProblem(null);
    void saveComputerCallMode(machine, next).then((error) => {
      if (error === null) return;
      setMode(previous);
      setProblem(`Couldn't save it on your computer: ${error}`);
    });
  };

  return (
    <SettingsSection name="settings:voice:call-mode">
      <SectionHeader title={`Voice agent on ${name}`} />
      {!switchedOn ? (
        <Caption>
          {`The voice agent is turned off on ${name}. Turn it on in Ghostex Settings › Extensions there to change how calls work.`}
        </Caption>
      ) : (
        <>
          {VOICE_CALL_MODES.map((choice) => (
            <ChoiceRow
              key={choice.mode}
              label={choice.label}
              selected={mode === choice.mode}
              onPress={() => choose(choice.mode)}
            />
          ))}
          {VOICE_CALL_MODES.map((choice) => (
            <Caption key={choice.mode}>{`${choice.label}: ${choice.detail}`}</Caption>
          ))}
          <Caption>{VOICE_CALL_MODE_NOTE}</Caption>
          <Caption>The voice agent keeps its own provider (OpenAI or xAI), set on the computer; Dictate's engine never changes it.</Caption>
          {mode === null && problem === null ? <Caption>Reading the setting from your computer…</Caption> : null}
          {problem !== null ? <Caption>{problem}</Caption> : null}
        </>
      )}
    </SettingsSection>
  );
}

/** The microphone: the one voice setting that belongs to the phone. */
function PhoneSection() {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  // Android says whether it is allowed without asking; an iPhone would ask, so it is not read there.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO).then(setAllowed, () => setAllowed(null));
  }, []);

  const phone = Platform.OS === 'ios' ? 'iPhone' : 'phone';
  const state = allowed === null ? '' : allowed ? 'Allowed. ' : 'Not allowed. ';
  return (
    <SettingsSection name="settings:voice:phone">
      <SectionHeader title="This phone" />
      <LinkRow
        title="Microphone"
        description={`${state}The ${phone}'s microphone, or a headset while one is connected.`}
        onPress={() => void Linking.openSettings().catch(() => undefined)}
      />
      <Caption>
        The phone records and the chat's computer transcribes. Ghostex asks for the microphone the first time you
        dictate; allow or block it in the phone's settings.
      </Caption>
    </SettingsSection>
  );
}

const local = StyleSheet.create({
  computer: { minHeight: 56, borderColor: GhostexPalette.ACCENT },
  inUse: { borderColor: GhostexPalette.ACCENT },
  modelTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  button: {
    paddingHorizontal: 10,
    height: 30,
    justifyContent: 'center',
    borderRadius: GhostexRadii.row,
  },
  buttonText: { fontSize: 13 },
  check: { fontSize: 16, fontWeight: '600', paddingHorizontal: 4 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', borderWidth: GhostexStrokeWidth, borderColor: 'transparent' },
  fill: { height: '100%', borderRadius: 2, backgroundColor: GhostexPalette.ACCENT },
});
