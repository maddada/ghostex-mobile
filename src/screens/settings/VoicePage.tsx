/**
 * Settings › Voice: Dictate and the voice agent on one computer, picked at the top, and the
 * phone's own settings at the bottom: the waiting music in calls (`voice/waitingMusic.ts`) and the
 * microphone. Dictate's engine (Hex 3 on that computer, OpenAI or xAI) and language live on that
 * computer and are read and saved through its gxserver (`voice/dictateSettings.ts`); so is the
 * voice agent's call mode.
 *
 * CDXC:VoiceMode 2026-11-05 DECISION: User (Q1275): "Settings › Voice, with a computer picker at the top". Each paired computer has its own Dictate engine, since its gxserver transcribes; the microphone stays a phone setting. The page replaces Settings › Voice agent, whose call mode is now its Voice agent section.
 */

import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import ActionSheet from '../../components/common/ActionSheet';
import { PlusGlyph, XGlyph } from '../../components/sessions/icons';
import { useInventoryStore } from '../../inventory/store';
import { jobActive, runRowAction, useMachineToolsStore } from '../../machines/machineTools';
import { machineDisplayLabel, machineName, type MachineRecord } from '../../machines/store';
import type { RootStackParamList } from '../../navigation/types';
import { GhostexPalette } from '../../theme/palette';
import { useAppearance } from '../../theme/useAppearance';
import {
  readComputerCallMode,
  saveComputerCallMode,
  saveComputerVoiceAgent,
  callModeSwitchesLive,
  sameTurnWord,
  turnWordsPhrase,
  voiceAgentCallLanguage,
  voiceAgentDefaultTurnWords,
  voiceAgentTurnWords,
  voiceCallModeNote,
  waitForReplyText,
  TURN_WORD_MAX_LENGTH,
  TURN_WORDS_MAX,
  VOICE_AGENT_DEVICE_LANGUAGE,
  VOICE_CALL_MODES,
  type VoiceAgentLanguage,
  type VoiceAgentSettingsChange,
  type VoiceCallMode,
} from '../../voice/conversation';
import {
  dictateEngines,
  engineCaption,
  languageLabel,
  phoneDictationNote,
  type DictateEngineId,
} from '../../voice/dictateModel';
import {
  changeDictate,
  chooseVoiceComputer,
  loadDictate,
  readDictateEngine,
  useDictateStore,
} from '../../voice/dictateSettings';
import { voiceAgentOnIn } from '../../voice/featureSwitch';
import {
  closeVoiceAgentNotice,
  startVoiceAgentRead,
  startVoiceAgentSave,
  voiceAgentOperation,
  voiceAgentUnclearChange,
  voiceAgentUnsettledWrite,
  type UnclearChange,
  type VoiceAgentRead,
  type VoiceAgentReadOutcome,
  type VoiceAgentSaveOutcome,
} from '../../voice/voiceAgentSaves';
import {
  changeWaitingMusic,
  loadWaitingMusic,
  previewWaitingMusic,
  stopWaitingMusicPreview,
  useWaitingMusicStore,
  waitingMusicSupported,
  WAITING_MUSIC_PIECES,
  WAITING_MUSIC_VOLUME_MAX,
  WAITING_MUSIC_VOLUME_MIN,
  type WaitingMusicPiece,
} from '../../voice/waitingMusic';
import { SettingsSection } from './SectionBoundary';
import {
  Caption,
  NoticeCard,
  ChoiceRow,
  LinkRow,
  SectionHeader,
  SegmentedRow,
  SettingsScreenLayout,
  SettingsSlider,
  ToggleRow,
  useSettingsStyles,
} from './SettingsControls';
import { SettingsSearchAnchor } from './search/SettingsSearchAnchor';
import { computerName, useVoiceComputer } from './voiceComputer';
import { isDemoMachine } from '../../demo/identity';
import { DemoCopy } from '../../demo/copy';

export default function VoicePage() {
  const { machine, machines } = useVoiceComputer();
  const loadedFor = useDictateStore((state) => state.loadedFor);
  const machineId = machine?.id ?? null;
  // Whether the voice agent section has a read or a save in flight for the shown computer; the picker is locked meanwhile.
  const [voiceAgentBusy, setVoiceAgentBusy] = useState(false);

  // Read fresh each time the page opens or another computer is picked (not when the record's
  // other fields change, such as its last connection time).
  useEffect(() => {
    if (machine === null || isDemoMachine(machine)) return;
    chooseVoiceComputer(machine.id);
    void loadDictate(machine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineId]);

  if (machine === null) {
    return (
      <SettingsScreenLayout>
        <Caption>Connect a computer first: Dictate and the voice agent run on your computer.</Caption>
        <WaitingMusicSection />
        <PhoneSection />
      </SettingsScreenLayout>
    );
  }
  if (isDemoMachine(machine)) {
    return (
      <SettingsScreenLayout>
        {machines.length > 1 ? <ComputerPicker machine={machine} machines={machines} locked={false} /> : null}
        <Caption>{DemoCopy.voiceNote}</Caption>
      </SettingsScreenLayout>
    );
  }
  return (
    <SettingsScreenLayout>
      <ComputerPicker machine={machine} machines={machines} locked={voiceAgentBusy} />
      {loadedFor === machine.id ? <DictateSection machine={machine} /> : null}
      <CallModeSection machine={machine} onBusyChange={setVoiceAgentBusy} />
      <WaitingMusicSection />
      <PhoneSection />
    </SettingsScreenLayout>
  );
}

/**
 * The card at the top: which computer the settings below are saved on; a tap picks another.
 *
 * CDXC:VoiceMode 2026-11-26 DECISION: User: while a save or a read of the voice agent settings is in flight for the shown computer, the computer picker is locked too, so nobody can switch away and back during an operation. The lock ends as soon as the operation ends: a success, a refusal once the read after it answered, that read failing for good, or the request running out of time. After a failed or timed-out read, switching to another computer works again at once, and on the page itself only Try again works.
 * WHY: switching away and back while a save was in flight started a second operation on that computer, so the page could show and then edit the language the save was replacing.
 */
function ComputerPicker({
  machine,
  machines,
  locked,
}: {
  machine: MachineRecord;
  machines: MachineRecord[];
  /** A read or save of the voice agent section is in flight: no other computer can be picked. */
  locked: boolean;
}) {
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
          setEngines((known) => ({
            ...known,
            [entry.id]: engine === null ? "Couldn't reach it" : `Dictate: ${engine.label}`,
          }));
      });
    }
    return () => {
      live = false;
    };
  }, [open, machines]);

  return (
    <SettingsSection name="settings:voice:computer">
      <SettingsSearchAnchor label="Computer">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Voice settings for ${machineDisplayLabel(machine)}`}
          accessibilityHint={several ? (locked ? 'Waiting for the voice agent settings' : 'Picks another computer') : undefined}
          accessibilityState={{ disabled: !several || locked, busy: locked }}
          disabled={!several || locked}
          onPress={() => setOpen(true)}
          style={({ pressed }) => [styles.row, local.computer, pressed && styles.rowPressed, locked && styles.rowDisabled]}
        >
          <View style={styles.linkText}>
            <Text style={styles.linkTitle}>{machineDisplayLabel(machine)}</Text>
            <Text style={styles.linkDescription}>{`The settings below are saved on ${machineName(machine)}`}</Text>
          </View>
          {several ? <Text style={[styles.chevron, { color: appearance.muted }]}>⌄</Text> : null}
        </Pressable>
      </SettingsSearchAnchor>
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
            if (locked) return;
            chooseVoiceComputer(entry.id);
          },
        }))}
        onClose={() => setOpen(false)}
      />
    </SettingsSection>
  );
}

/** Dictate on the picked computer: engine, Hex and its models, and language. */
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
          <NoticeCard
            title="Couldn't read Dictate's settings"
            detail={`${name}: ${problem ?? 'no answer'}`}
            actions={[{ label: 'Try again', onPress: () => void loadDictate(machine) }]}
          />
        ) : null}
      </SettingsSection>
    );
  }

  const { settings } = overview;
  const chooseEngine = (engine: DictateEngineId) => void changeDictate(machine, { engine });

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
      <Caption>{phoneDictationNote(name)}</Caption>
      {/* Superwhisper dictates in the language set in Superwhisper on the computer. */}
      {settings.engine === 'superwhisper' ? null : (
        <LinkRow
          title="Language"
          description={languageLabel(overview.languages, settings.language)}
          onPress={() => navigation.navigate('SettingsPage', { page: 'dictateLanguage' })}
        />
      )}
      {problem !== null ? <NoticeCard title="Couldn't change Dictate" detail={problem} /> : null}
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
          description={`Installs it on ${name}. Then open Hex there, allow the microphone and download a model in Hex's settings.`}
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
        <LinkRow
          title="Check again"
          description={`Asks Hex on ${name} again.`}
          onPress={() => void loadDictate(machine, true)}
        />
      ) : null}
      {failed ? <NoticeCard title="Hex wasn't installed" detail={failed} /> : null}
    </>
  );
}

/**
 * What the voice agent section is doing with its computer: reading its settings, showing why a read failed, saving
 * one change, showing that a save's outcome is unclear (`saveUnclear`: no answer within the deadline, or an answer
 * that is not the computer's refusal), waiting for such a save to end before reading again (`awaitingSave`), or
 * nothing (`idle`, the only phase in which a control works). Whether the computer has a read or save in flight is
 * voice/voiceAgentSaves.ts's to say (`voiceAgentOperation`); while it has one, the section shows that one.
 */
type CallModePhase = 'reading' | 'readFailed' | 'saving' | 'saveUnclear' | 'awaitingSave' | 'idle';

/**
 * The unclear change's notice below its first line, once the computer has been read again, built from that read
 * (`savedNow`): for the save's target language and the language calls speak now, the list read now (`Saved now`) and
 * the list read before the save (`Last read`), each the words in effect, named "default words" when they are the
 * defaults; then how to fix them, and how to show the turn words' editor when that read hides it. `shown` is the read
 * the controls below show (`null` while they show none). Only while it is `savedNow` are the lists current and the
 * notice says how to fix them; otherwise (the page was opened again, or a save was confirmed, and the computer is
 * being read again or that read failed) the lists are labelled as read before the last change, and with `tryAgain`
 * (only Try again works) the notice says to use it first. It says nothing about where the change landed.
 */
function unclearChangeDetail(change: UnclearChange, shown: VoiceAgentRead | null, tryAgain: boolean): string | undefined {
  const now = change.savedNow;
  const read = now?.agentLanguage ?? null;
  if (now === null || read === null) return undefined;
  const callLanguage = voiceAgentCallLanguage(read);
  const label = (code: string): string =>
    (read.languages.find((entry) => entry.code === code) ?? change.lastRead.languages.find((entry) => entry.code === code))
      ?.label ?? code;
  const words = (settings: VoiceAgentLanguage, code: string): string => {
    const list = voiceAgentTurnWords(settings, code);
    const defaults = voiceAgentDefaultTurnWords(settings, code);
    const atDefaults = list.length === defaults.length && list.every((word, index) => word === defaults[index]);
    return `${turnWordsPhrase(list)}${atDefaults ? ' (default words)' : ''}`;
  };
  const languages = change.target === callLanguage ? [callLanguage] : [change.target, callLanguage];
  if (shown !== now) {
    // The controls below do not show this read: until the computer has been read again nothing here is current.
    return [
      ...languages.map(
        (code) =>
          `${label(code)}\nRead before your last change: ${words(read, code)}\nLast read: ${words(change.lastRead, code)}`,
      ),
      ...(tryAgain
        ? ['Tap Try again below first. Once the settings have been read again, this notice says how to fix the turn words.']
        : []),
    ].join('\n\n');
  }
  const regular = VOICE_CALL_MODES.find((choice) => choice.mode === 'regular')?.label ?? 'Regular';
  const steps = [
    ...(now.mode !== 'regular' ? [`choose ${regular}`] : []),
    ...(now.waitForReply !== true ? ['turn on "Answer when I say …"'] : []),
  ];
  return [
    ...languages.map(
      (code) =>
        `${label(code)}${code === callLanguage ? ' (calls speak it now)' : ''}\nSaved now: ${words(read, code)}\nLast read: ${words(change.lastRead, code)}`,
    ),
    `For ${label(callLanguage)}, edit the turn words below. For another language, set Language to it for a moment, enter the words or tap Reset to default, then set Language back.`,
    ...(steps.length > 0
      ? [
          `The turn words show only for ${regular} calls with "Answer when I say …" on: ${steps.join(' and ')} to see them. You can change ${steps.length > 1 ? 'them' : 'it'} back afterwards.`,
        ]
      : []),
  ].join('\n\n');
}

/** The voice agent's call mode on the picked computer (the old Settings › Voice agent). */
function CallModeSection({
  machine,
  onBusyChange,
}: {
  machine: MachineRecord;
  /** Whether a read or a save is in flight (the page locks the computer picker meanwhile). */
  onBusyChange: (busy: boolean) => void;
}) {
  const styles = useSettingsStyles();
  // The computer's voice agent switch (Settings > Extensions there); its call mode means nothing while it is off.
  const switchedOn = useInventoryStore((state) => voiceAgentOnIn(state.inventoriesByMachineId[machine.id]?.summary));
  const [mode, setMode] = useState<VoiceCallMode | null>(null);
  const [waitForReply, setWaitForReply] = useState<boolean | null>(null);
  // `null`: a computer too old to have a language setting and turn words per language (the rows stay hidden).
  const [agentLanguage, setAgentLanguage] = useState<VoiceAgentLanguage | null>(null);
  // The read the controls show, until they are cleared for another read or show a value the computer confirmed; the
  // notice presents its lists as current only while they come from this read (see `unclearChangeDetail`).
  const [shownRead, setShownRead] = useState<VoiceAgentRead | null>(null);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [shownPhase, setPhase] = useState<CallModePhase>('reading');
  // The turn word typed but not added yet, per computer id. It is kept here rather than in the turn words' editor,
  // which is hidden while the settings are read again, so the word outlasts the lock, a refusal and the read after it;
  // only adding it or clearing the field empties it.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // This computer's unclear change, read from voice/voiceAgentSaves.ts while drawing, so another computer never shows
  // it; closing it draws the page again through `redraw`.
  const unclear = voiceAgentUnclearChange(machine.id);
  const inFlight = voiceAgentOperation(machine.id);
  const [, redraw] = useState(0);
  const name = computerName(machine);
  // CDXC:VoiceMode 2026-11-26 DECISION: User: per computer at most one operation is in flight, a save or the read that confirms or replaces it. A save of the call mode, "Answer when I say …", the language or the turn words locks all of these controls from the moment it starts until the page shows a value the computer confirmed: the saved value after a success, or, after a refusal, what the computer answers when it is read again. Nothing is shown before the computer confirmed it. If that read fails, only Try again works until a read succeeds; the page's first read locks the controls the same way. Switching computers during an operation is no longer possible: the computer picker is locked while a read or save is in flight (see `ComputerPicker`), which replaces dropping the answer of an operation left behind on another computer.
  // CDXC:VoiceMode 2026-11-26 DECISION: User: a save that runs out of the deadline has an unclear outcome: every edit for that computer stays locked and only Try again works, and Try again reads only once that save has really ended (answered or failed); until then it waits and says so. Switching to another computer stays free at once.
  // WHY: optimistic saves running beside re-reads let an older answer overtake a newer one, so the page showed (and the next turn-word edit used) a value the computer did not have; a read sent while a timed-out save is still running can be overtaken by that save the same way.
  // CDXC:VoiceMode 2026-11-26 DECISION: User: a save whose answer is not the computer's refusal (a timeout or a lost request) has an unclear outcome too, like one that runs out of the deadline. When it saved the language or turn words, a notice above the controls says "The last change on <computer> is unclear. Please check the turn words." and, once the computer has been read again, shows for the save's language and the language calls speak now the list read now ("Saved now") beside the one read before the save ("Last read"), and how to fix them. It never says where a word landed, and it stays until the user closes it, also when the page is closed and opened again.
  // WHY: a turn word save writes the whole list of every language, so a save the computer may still carry out can overwrite another language's words, and the phone cannot tell where it landed.
  // CDXC:VoiceMode 2026-11-26 DECISION: User: the notice and the turn words' editor are built from the same read: while the notice is open, a confirmed save is followed by a read of the computer, and the editor and the notice show what that read returned. "Last read" shows only lists the phone read from the computer, never what it sent. When that read hides the editor, the notice says how to show it (Regular calls with "Answer when I say …" on) and that the user can change those back afterwards.
  // WHY: after the recovery's language change the notice still named the language read before it while the editor below edited another one, and "Last read" could show words the phone had sent but never read.
  // CDXC:VoiceMode 2026-11-26 DECISION: User: while the notice is open and the controls below do not show the read its lists come from (the page was opened again or a save was confirmed, and the new read is pending or failed), the notice labels those lists "Read before your last change", not "Saved now", and says nothing about fixing them; after a failed read it says to use Try again first. Once the new read answers, the notice shows "Saved now" from that read and how to fix the turn words.
  // WHY: a page opened again with an earlier read showed that read as "Saved now" and pointed to the turn words below while the page was still reading or the read had failed, so the editor it named was not there.
  // `phase` is what the page waits for; `operation.current.phase` mirrors it so a second tap before the next render sends nothing. Every operation the page waits for takes the next generation, and unmounting or a new computer takes one too, so an answer changes the page only while the page still waits for it. That guard drops only what the page shows: voice/voiceAgentSaves.ts records every outcome for its computer whatever the page does meanwhile.
  const operation = useRef<{ generation: number; phase: CallModePhase }>({ generation: 0, phase: 'reading' });
  const phase: CallModePhase = inFlight === undefined ? shownPhase : inFlight.kind === 'save' ? 'saving' : 'reading';
  const locked = phase !== 'idle';
  const lateAnswer = `Ghostex on ${name} didn't answer in time.`;

  const enter = (next: CallModePhase) => {
    operation.current.phase = next;
    setPhase(next);
    // Waiting for a timed-out save to end is not an operation of the page: switching computers stays free.
    onBusyChange(next === 'reading' || next === 'saving');
  };

  /** Shows the read `outcome` while the page still waits for it (`generation`); `refusal` as in `load`. */
  const showRead = (generation: number, refusal: string | null, outcome: Promise<VoiceAgentReadOutcome>) => {
    void outcome.then((answer) => {
      if (operation.current.generation !== generation) return;
      if ('read' in answer) {
        setMode(answer.read.mode);
        setWaitForReply(answer.read.waitForReply);
        setAgentLanguage(answer.read.agentLanguage);
        setShownRead(answer.read);
        enter('idle');
      } else {
        const error = answer.error ?? lateAnswer;
        setProblem(refusal === null ? error : `${refusal} Couldn't read the settings again: ${error}`);
        enter('readFailed');
      }
    });
  };

  /**
   * Shows the save `outcome` while the page still waits for it (`generation`): a success shows the saved value through
   * `confirmed`, or, while the notice is open or the value is unknown (a save started before the page opened), what
   * the computer answers when it is read again; a refusal shows why and reads the computer again; an unclear outcome
   * leaves only Try again (see `load`).
   */
  const showSave = (generation: number, outcome: Promise<VoiceAgentSaveOutcome>, confirmed?: () => void) => {
    void outcome.then((answer) => {
      if (operation.current.generation !== generation) return;
      if (answer.kind === 'unclear') {
        setProblem(
          answer.answer === null
            ? `Couldn't save it on your computer: ${lateAnswer} The change may still arrive; Try again reads the settings once ${name} has answered it.`
            : `Couldn't save it on your computer: ${answer.answer} The change may still arrive; Try again reads the settings again.`,
        );
        enter('saveUnclear');
      } else if (answer.kind === 'refused') {
        load(`Couldn't save it on your computer: ${answer.error}`);
      } else if (confirmed === undefined || voiceAgentUnclearChange(machine.id) !== undefined) {
        load(null);
      } else {
        setShownRead(null);
        confirmed();
        enter('idle');
      }
    });
  };

  /**
   * Reads the computer's settings; `refusal` is the reason shown meanwhile and kept after the read. While a save of
   * this computer is still unanswered, it waits for that save to end first.
   */
  const load = (refusal: string | null) => {
    const generation = ++operation.current.generation;
    setMode(null);
    setWaitForReply(null);
    setAgentLanguage(null);
    setShownRead(null);
    setProblem(refusal);
    const unsettled = voiceAgentUnsettledWrite(machine.id);
    if (unsettled !== undefined) {
      enter('awaitingSave');
      void unsettled.then(() => {
        if (operation.current.generation === generation) load(refusal);
      });
      return;
    }
    const outcome = startVoiceAgentRead(machine.id, () => readComputerCallMode(machine));
    enter('reading');
    showRead(generation, refusal, outcome);
  };

  /**
   * Sends `save` only while nothing else is in flight, with every control locked until it is answered (see
   * `showSave`). `language` is the language whose turn words a save of the language or of turn words concerns; for
   * such a save an unclear outcome also opens the notice to check the turn words.
   */
  const saveThen = (save: () => Promise<string | null>, confirmed: () => void, language?: string) => {
    if (operation.current.phase !== 'idle' || voiceAgentOperation(machine.id) !== undefined) return;
    const generation = ++operation.current.generation;
    setProblem(null);
    const outcome = startVoiceAgentSave(machine.id, save, language);
    enter('saving');
    showSave(generation, outcome, confirmed);
  };

  useEffect(() => {
    // A read or save still in flight from before the page opened (or before it showed another computer) keeps the
    // page and the picker locked until it is answered or runs out; otherwise the page reads.
    const pending = voiceAgentOperation(machine.id);
    if (pending === undefined) {
      load(null);
    } else {
      const generation = ++operation.current.generation;
      setMode(null);
      setWaitForReply(null);
      setAgentLanguage(null);
      setShownRead(null);
      setProblem(null);
      enter(pending.kind === 'save' ? 'saving' : 'reading');
      if (pending.kind === 'save') showSave(generation, pending.outcome);
      else showRead(generation, null, pending.outcome);
    }
    return () => {
      // Reads and saves of this computer no longer change the page, and the picker is free again.
      operation.current.generation += 1;
      onBusyChange(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine.id]);

  const choose = (next: VoiceCallMode) => {
    if (next === mode) return;
    saveThen(
      () => saveComputerCallMode(machine, next),
      () => setMode(next),
    );
  };

  const chooseWait = (next: boolean) => {
    saveThen(
      () => saveComputerVoiceAgent(machine, { waitForReply: next }),
      () => setWaitForReply(next),
    );
  };

  /** Saves `change`, which concerns `language`'s turn words; once the computer took it, the page shows `next`. */
  const saveLanguageSetting = (change: VoiceAgentSettingsChange, next: VoiceAgentLanguage, language: string) => {
    saveThen(
      () => saveComputerVoiceAgent(machine, change),
      () => setAgentLanguage(next),
      language,
    );
  };

  // The language a call from this phone speaks, whose turn words the switch names and the editor changes.
  const callLanguage = agentLanguage === null ? null : voiceAgentCallLanguage(agentLanguage);
  const words = agentLanguage === null || callLanguage === null ? null : voiceAgentTurnWords(agentLanguage, callLanguage);
  const waitText = waitForReplyText(words);
  const languageName = (code: string): string =>
    agentLanguage?.languages.find((entry) => entry.code === code)?.label ?? code;

  const chooseLanguage = (language: string) => {
    setLanguageOpen(false);
    if (agentLanguage === null || language === agentLanguage.language) return;
    // Calls speak the chosen language's code, or for "Same as this phone" the phone's language when offered.
    const next = { ...agentLanguage, language };
    saveLanguageSetting({ language }, next, voiceAgentCallLanguage(next));
  };

  /** Saves the call language's turn words; an empty list brings back its defaults. */
  const saveTurnWords = (next: string[]) => {
    if (agentLanguage === null || callLanguage === null) return;
    const effective = next.length === 0 ? voiceAgentDefaultTurnWords(agentLanguage, callLanguage) : next;
    saveLanguageSetting(
      { turnWordsLanguage: callLanguage, turnWords: next },
      { ...agentLanguage, turnWords: { ...agentLanguage.turnWords, [callLanguage]: effective } },
      callLanguage,
    );
  };

  const status =
    phase === 'saving'
      ? `Saving on ${name}…`
      : phase === 'reading'
        ? 'Reading the setting from your computer…'
        : phase === 'awaitingSave'
          ? `Waiting for ${name} to answer the last change before reading the settings again…`
          : phase === 'readFailed'
            ? `Couldn't read the settings from ${name}. Try again below.`
            : phase === 'saveUnclear'
              ? `${name} hasn't answered the last change. Try again below.`
              : null;
  const waiting = phase === 'saving' || phase === 'reading' || phase === 'awaitingSave';
  // A failed read (the first one, or the one after a refusal) or a save without an answer: only Try again works, and
  // it reads once no save of this computer is unanswered any more.
  const tryAgain = phase === 'readFailed' || phase === 'saveUnclear';

  return (
    <SettingsSection name="settings:voice:call-mode">
      <SectionHeader title={`Voice agent on ${name}`} />
      {!switchedOn ? (
        <Caption>
          {`The voice agent is turned off on ${name}. Turn it on in Ghostex Settings › Extensions there to change how calls work.`}
        </Caption>
      ) : (
        <>
          {/* Outside the controls, so its Close works and it is announced while they are locked. */}
          {unclear !== undefined ? (
            <NoticeCard
              title={`The last change on ${name} is unclear. Please check the turn words.`}
              detail={unclearChangeDetail(unclear, shownRead, tryAgain)}
              actions={[
                {
                  label: 'Close',
                  onPress: () => {
                    closeVoiceAgentNotice(machine.id);
                    redraw((count) => count + 1);
                  },
                },
              ]}
            />
          ) : null}
          {/* While locked the controls are dimmed, take no touches, and read as one busy element. */}
          <View
            pointerEvents={locked ? 'none' : 'auto'}
            accessible={locked}
            accessibilityLabel={status ?? undefined}
            accessibilityState={{ disabled: locked, busy: waiting }}
            style={[local.controls, locked ? styles.rowDisabled : null]}
          >
            {VOICE_CALL_MODES.map((choice) => (
              <ChoiceRow
                key={choice.mode}
                label={choice.label}
                selected={mode === choice.mode}
                onPress={() => choose(choice.mode)}
              />
            ))}
            {/* CDXC:VoiceMode 2026-11-25 DECISION: User: the voice agent's language is a setting, by default the calling device's language, and the turn words are set per language. A computer that has them gets a Language row (a picker with "Same as this phone" and its languages) and, under the switch, the turn words of the language a call from this phone speaks; the switch names those words. A computer too old to have them shows the page as before. */}
            {agentLanguage !== null && callLanguage !== null ? (
              <>
                <LinkRow
                  title="Language"
                  description={
                    agentLanguage.language === VOICE_AGENT_DEVICE_LANGUAGE
                      ? `Same as this phone: ${languageName(callLanguage)}`
                      : languageName(agentLanguage.language)
                  }
                  onPress={() => setLanguageOpen(true)}
                />
                <ActionSheet
                  visible={languageOpen}
                  title="Voice agent language"
                  subtitle={`The language the voice agent on ${name} speaks in calls.`}
                  items={[
                    {
                      key: VOICE_AGENT_DEVICE_LANGUAGE,
                      label: 'Same as this phone',
                      detail: languageName(
                        voiceAgentCallLanguage({ ...agentLanguage, language: VOICE_AGENT_DEVICE_LANGUAGE }),
                      ),
                    },
                    ...agentLanguage.languages.map((entry) => ({ key: entry.code, label: entry.label })),
                  ].map((item) => {
                    const selected = agentLanguage.language === item.key;
                    return {
                      ...item,
                      label: `${selected ? '✓ ' : ''}${item.label}`,
                      selected,
                      onPress: () => chooseLanguage(item.key),
                    };
                  })}
                  onClose={() => setLanguageOpen(false)}
                />
              </>
            ) : null}
            {/* CDXC:VoiceMode 2026-11-12 DECISION: User (Q2749): the phone gets the desktop's "Answer when I say "reply"" switch, saved on the computer like the call mode, and shown only for Regular calls (Q2748); server/src/voice_agent/keys.rs holds the decision. A computer too old to have it shows no row. */}
            {mode === 'regular' && waitForReply !== null ? (
              <ToggleRow
                label={waitText.label}
                detail={waitText.detail}
                value={waitForReply}
                onValueChange={chooseWait}
              />
            ) : null}
            {mode === 'regular' &&
            waitForReply === true &&
            agentLanguage !== null &&
            callLanguage !== null &&
            words !== null ? (
              <TurnWordsBlock
                languageName={languageName(callLanguage)}
                language={callLanguage}
                words={words}
                defaults={voiceAgentDefaultTurnWords(agentLanguage, callLanguage)}
                disabled={locked}
                draft={drafts[machine.id] ?? ''}
                onDraftChange={(draft) => setDrafts((known) => ({ ...known, [machine.id]: draft }))}
                onSave={saveTurnWords}
              />
            ) : null}
          </View>
          {waiting ? <Caption>{status}</Caption> : null}
          {VOICE_CALL_MODES.map((choice) => (
            <Caption key={choice.mode}>{`${choice.label}: ${choice.detail}`}</Caption>
          ))}
          <Caption>{voiceCallModeNote(callModeSwitchesLive(machine.id))}</Caption>
          <Caption>
            The voice agent keeps its own provider (OpenAI or xAI), set on the computer; Dictate's engine never changes
            it.
          </Caption>
          {problem !== null ? (
            <NoticeCard
              title="Couldn't change the setting"
              detail={problem}
              actions={tryAgain ? [{ label: 'Try again', onPress: () => load(null) }] : undefined}
            />
          ) : null}
        </>
      )}
    </SettingsSection>
  );
}

/**
 * The turn words of the language a call from this phone speaks: one row per word with a remove
 * button (the last word stays; Reset to default brings back the defaults), a field that adds one,
 * and Reset to default while they differ from the defaults. Each change is saved at once; while
 * `disabled` (a save or read in flight) nothing can be changed. The field's text is `draft`, held by
 * the section so that it stays while this editor is hidden. A word the computer would take for one
 * already in the list (`sameTurnWord`) is not added: the field keeps it and a line under it says
 * which word is already there, until the field changes.
 */
function TurnWordsBlock({
  languageName,
  language,
  words,
  defaults,
  disabled,
  draft,
  onDraftChange,
  onSave,
}: {
  languageName: string;
  /** The code of the language the words belong to, which decides how case is compared. */
  language: string;
  words: string[];
  defaults: string[];
  disabled: boolean;
  /** The word typed in the field and not added yet. */
  draft: string;
  onDraftChange: (draft: string) => void;
  /** The new list; empty brings back the defaults. */
  onSave: (words: string[]) => void;
}) {
  const styles = useSettingsStyles();
  const appearance = useAppearance();
  /** The field's text when Add refused it as a word already in the list. */
  const [refused, setRefused] = useState<string | null>(null);
  const atDefaults = words.length === defaults.length && words.every((word, index) => word === defaults[index]);
  const cannotAdd = disabled || draft.trim().length === 0;
  const listed = (word: string) => words.find((known) => sameTurnWord(known, word, language));
  const alreadyListed = refused === draft ? listed(draft.trim()) : undefined;

  const add = () => {
    const word = draft.trim();
    if (disabled || word.length === 0) return;
    if (listed(word) !== undefined) {
      setRefused(draft);
      return;
    }
    onDraftChange('');
    onSave([...words, word]);
  };

  return (
    <>
      {/* Settings search's "Turn words" lands here, at the top of the words. */}
      <SettingsSearchAnchor label="Turn words">
        <Caption>{`Turn words in ${languageName}: end what you say with one of them and the voice agent answers.`}</Caption>
      </SettingsSearchAnchor>
      {words.map((word) => (
        <View key={word} style={styles.row}>
          <Text style={styles.rowLabel}>{word}</Text>
          {words.length > 1 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove turn word “${word}”`}
              accessibilityState={{ disabled }}
              disabled={disabled}
              hitSlop={8}
              style={local.remove}
              onPress={() => onSave(words.filter((entry) => entry !== word))}
            >
              <XGlyph size={14} color={appearance.mutedGlyph} />
            </Pressable>
          ) : null}
        </View>
      ))}
      {words.length < TURN_WORDS_MAX ? (
        <View style={styles.row}>
          <TextInput
            keyboardAppearance={appearance.light ? 'light' : 'dark'}
            accessibilityLabel={`New turn word in ${languageName}`}
            placeholder="Add a turn word"
            placeholderTextColor={appearance.muted}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={TURN_WORD_MAX_LENGTH}
            returnKeyType="done"
            editable={!disabled}
            style={[styles.rowLabel, local.field]}
            value={draft}
            onChangeText={(text) => {
              setRefused(null);
              onDraftChange(text);
            }}
            onSubmitEditing={add}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add turn word"
            accessibilityState={{ disabled: cannotAdd }}
            disabled={cannotAdd}
            hitSlop={8}
            style={local.remove}
            onPress={add}
          >
            <PlusGlyph size={18} color={cannotAdd ? appearance.mutedGlyph : appearance.foreground} />
          </Pressable>
        </View>
      ) : null}
      {words.length < TURN_WORDS_MAX && alreadyListed !== undefined ? (
        <Caption>{`"${alreadyListed}" is already in the list.`}</Caption>
      ) : null}
      {!atDefaults ? (
        <LinkRow title="Reset to default" description={`Back to ${turnWordsPhrase(defaults)}`} onPress={() => onSave([])} />
      ) : null}
    </>
  );
}

/**
 * The voice agent's waiting music in calls on this phone (`voice/waitingMusic.ts`): the switch, its own volume and the
 * piece, each with a short preview. Saved on this phone, so it shows without a computer too.
 */
function WaitingMusicSection() {
  const settings = useWaitingMusicStore((state) => state.settings);
  const loaded = useWaitingMusicStore((state) => state.loaded);
  const previewing = useWaitingMusicStore((state) => state.previewing);
  const supported = waitingMusicSupported();

  useEffect(() => {
    void loadWaitingMusic();
  }, []);
  // A preview stops when the page is left, covered by another page, or closed.
  useFocusEffect(useCallback(() => stopWaitingMusicPreview, []));

  return (
    <SettingsSection name="settings:voice:waiting-music">
      <SectionHeader title="Calls on this phone" />
      {!supported ? (
        <Caption>Waiting music needs a newer version of the Ghostex app on this phone.</Caption>
      ) : !loaded ? null : (
        <>
          <ToggleRow
            label="Waiting music"
            detail="After the agent first speaks in a call, plays quietly if it thinks or runs a tool for 1.5 seconds. Fades out when the agent speaks or you talk."
            value={settings.enabled}
            onValueChange={(enabled) => void changeWaitingMusic({ enabled })}
          />
          {/* Shown while the music is off too: the volume and piece can be set, and previewed, before turning it on. */}
          <SettingsSlider
            label="Waiting music volume"
            minimumValue={WAITING_MUSIC_VOLUME_MIN}
            maximumValue={WAITING_MUSIC_VOLUME_MAX}
            // Stepless; 5 % is only how far a VoiceOver or TalkBack swipe moves it.
            step={5}
            continuous
            value={settings.volumePercent}
            valueLabel={`${Math.round(settings.volumePercent)}%`}
            onValueChange={(volumePercent) => void changeWaitingMusic({ volumePercent })}
          />
          <Caption>Its own volume, as a share of the call's: the agent's voice stays as it is.</Caption>
          {WAITING_MUSIC_PIECES.map((piece) => (
            <MusicPieceRow
              key={piece.id}
              piece={piece}
              selected={settings.piece === piece.id}
              previewing={previewing === piece.id}
            />
          ))}
          <Caption>
            Saved on this phone only. The music is from OpenGameArt, given to the public domain by its authors (CC0).
          </Caption>
        </>
      )}
    </SettingsSection>
  );
}

/** One piece: a tap picks it; Preview plays a few seconds of it (Stop ends that early). */
function MusicPieceRow({
  piece,
  selected,
  previewing,
}: {
  piece: WaitingMusicPiece;
  selected: boolean;
  previewing: boolean;
}) {
  const styles = useSettingsStyles();
  return (
    <SettingsSearchAnchor label={piece.title}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected }}
          accessibilityLabel={`${piece.title}, by ${piece.author}`}
          style={local.pieceChoice}
          onPress={() => void changeWaitingMusic({ piece: piece.id })}
        >
          <View style={styles.rowText}>
            <Text style={styles.cardLabel}>{piece.title}</Text>
            <Text style={styles.linkDescription}>{piece.author}</Text>
          </View>
          <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
            {selected && <View style={styles.radioInner} />}
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={previewing ? `Stop the preview of ${piece.title}` : `Preview ${piece.title}`}
          hitSlop={6}
          style={({ pressed }) => [styles.stepperButton, local.previewButton, pressed && styles.rowPressed]}
          onPress={() => (previewing ? stopWaitingMusicPreview() : void previewWaitingMusic(piece.id))}
        >
          <Text style={styles.segmentText}>{previewing ? 'Stop' : 'Preview'}</Text>
        </Pressable>
      </View>
    </SettingsSearchAnchor>
  );
}

/** The microphone, a setting of the phone itself. */
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
  // The voice agent's controls in one lockable group, spaced like the Settings list's own rows (`list` gap).
  controls: { gap: 8 },
  field: { flex: 1, minHeight: 32, paddingVertical: 4 },
  remove: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  pieceChoice: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  previewButton: { width: 'auto', minWidth: 76, paddingHorizontal: 12 },
});
