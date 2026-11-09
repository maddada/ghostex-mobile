/**
 * Import Team and Export Team on the phone, from the GBots heading's long press (use-gbots.tsx), drawn like the
 * desktop's GBots Team window (apps/desktop/src/app/window/gbot_team_modal/).
 *
 * Import: the file the user picked is previewed first (`ghostex gbots team import --dry-run`): the GBots it adds,
 * their departments, their routines (they arrive paused), what the file left out and anything that keeps it from
 * importing. Import adds it (gxserver asks for the user's approval first and the command waits), then Undo removes the
 * whole import. A preset file is kept for New GBot instead.
 *
 * Export: the whole team, a department or one GBot (a preset), with or without starter notes; the file goes to the
 * share sheet (iOS shares a .json file, Android its text, as Save to Markdown does in SaveMarkdownDialog.tsx).
 *
 * CDXC:GBots 2026-11-09 SEE-ALSO: the DECISION in apps/desktop/src/app/window/gbot_team_modal/mod.rs.
 */

import { File, Paths } from 'expo-file-system';
import { useState, type ReactElement } from 'react';
import { ActivityIndicator, Platform, Share, Switch, Text, View } from 'react-native';

import { runGhostexCli } from '../../components/sessions/cli';
import { GbotIcon } from '../../components/sessions/gbotIcons';
import {
  gbotsPresetImportCommand,
  gbotsTeamExportCommand,
  gbotsTeamImportCommand,
  gbotsUndoCommand,
} from '../../commands/ghostexCli';
import {
  parseTeamExported,
  parseTeamImported,
  type TeamBotRow,
  type TeamImported,
  type TeamPreview,
} from '../../contract/gbotTeam';
import type { MachineRecord } from '../../machines/store';
import { GbotChoiceChips, GbotSheetButtons, GbotSheetCard, useGbotFormStyles } from './GbotFormParts';

/** An import or a kept preset waits for the user's approval on the computer or phone. */
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const NEVER_IN =
  'Secrets are redacted. Chats, the agent and model each GBot runs on, approval levels, computers, keys and sign-ins never go in a team file.';

export type GbotTeamSheetProps = {
  target: MachineRecord;
  /** Import: the picked file (base64) and its preview. Export: the GBots and departments to pick from. */
  start:
    | { kind: 'import'; fileBase64: string; preview: TeamPreview }
    | { kind: 'export'; bots: { id: string; name: string }[]; departments: { id: string; name: string }[] };
  onChanged: () => void;
  onClose: () => void;
};

function BotRows({ bots }: { bots: TeamBotRow[] }): ReactElement {
  const { appearance, styles } = useGbotFormStyles();
  return (
    <View style={{ gap: 10, marginBottom: 12 }}>
      {bots.map((bot, index) => (
        <View key={`${bot.name}-${index}`} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
          <View style={{ paddingTop: 2 }}>
            <GbotIcon icon={bot.icon} color={bot.colorHex} size={16} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: appearance.foreground, fontSize: 14, fontWeight: '600' }}>
              {bot.name}
              {bot.renamedFrom !== null ? <Text style={styles.hint}>{`  was ${bot.renamedFrom}`}</Text> : null}
            </Text>
            {bot.detail.length > 0 ? <Text style={styles.hint}>{bot.detail}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

function Lines({ title, lines, danger }: { title: string; lines: string[]; danger?: boolean }): ReactElement | null {
  const { appearance, styles } = useGbotFormStyles();
  if (lines.length === 0) return null;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{title}</Text>
      {lines.map((line, index) => (
        <Text key={index} style={[styles.hint, danger === true ? { color: appearance.danger } : null]}>
          {`• ${line}`}
        </Text>
      ))}
    </View>
  );
}

/** Hands the file to the share sheet under its name. */
async function shareFile(text: string, name: string): Promise<void> {
  if (Platform.OS === 'ios') {
    const file = new File(Paths.cache, name);
    file.create({ intermediates: true, overwrite: true });
    await file.write(text);
    await Share.share({ url: file.uri, title: name });
    return;
  }
  await Share.share({ title: name, message: text }, { dialogTitle: name });
}

export default function GbotTeamSheet({ target, start, onChanged, onClose }: GbotTeamSheetProps): ReactElement {
  const { appearance, styles } = useGbotFormStyles();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<TeamImported | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [scope, setScope] = useState('team');
  const [pick, setPick] = useState('');
  const [notes, setNotes] = useState(false);
  const spinner = <ActivityIndicator color={appearance.accentForeground} />;

  const run = (work: () => Promise<void>): void => {
    if (busy) return;
    setBusy(true);
    setError(null);
    work()
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
      .finally(() => setBusy(false));
  };

  const finished = (title: string, body: string): ReactElement => (
    <GbotSheetCard
      onCancel={onClose}
      footer={
        <GbotSheetButtons
          primaryLabel="Done"
          canPress
          busy={false}
          onCancel={onClose}
          onPress={onClose}
          spinner={spinner}
        />
      }
    >
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </GbotSheetCard>
  );

  if (done !== null) return finished('Done', done);

  if (start.kind === 'export') {
    const choices = scope === 'department' ? start.departments : scope === 'bot' ? start.bots : [];
    const ready = scope === 'team' || pick.length > 0;
    const exportNow = (): void =>
      run(async () => {
        const result = await runGhostexCli(
          target,
          gbotsTeamExportCommand({
            department: scope === 'department' ? pick : undefined,
            preset: scope === 'bot' ? pick : undefined,
            notes,
          }),
        );
        const exported = parseTeamExported(result.json);
        await shareFile(exported.text, exported.fileName);
        const left = exported.leftOut.length > 0 ? ` Left out: ${exported.leftOut.join('; ')}.` : '';
        setDone(`Shared ${exported.summary} as ${exported.fileName}.${left}`);
      });
    return (
      <GbotSheetCard
        onCancel={onClose}
        footer={
          <GbotSheetButtons
            primaryLabel="Share File"
            canPress={ready && !busy}
            busy={busy}
            onCancel={onClose}
            onPress={exportNow}
            spinner={spinner}
          />
        }
      >
        <Text style={styles.title}>Export Team</Text>
        <Text style={styles.body}>Write your GBots to one JSON file you can import on another Ghostex.</Text>
        <View style={styles.field}>
          <GbotChoiceChips
            label="What to export"
            options={[
              { value: 'team', label: 'Whole team' },
              { value: 'department', label: 'A department' },
              { value: 'bot', label: 'One GBot' },
            ]}
            value={scope}
            onChange={(value) => {
              setScope(value);
              setPick('');
            }}
          />
        </View>
        {choices.length > 0 ? (
          <View style={styles.field}>
            <GbotChoiceChips
              label={scope === 'bot' ? 'GBot' : 'Department'}
              options={choices.map((choice) => ({ value: choice.id, label: choice.name }))}
              value={pick}
              onChange={setPick}
            />
          </View>
        ) : scope !== 'team' ? (
          <Text style={styles.hint}>
            {scope === 'bot' ? 'There are no GBots yet.' : 'There are no departments yet.'}
          </Text>
        ) : null}
        {scope === 'bot' ? (
          <Text style={styles.hint}>One GBot is written as a preset: New GBot can start from it on any Ghostex.</Text>
        ) : null}
        <View style={[styles.field, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: appearance.foreground, fontSize: 14 }}>Include starter notes</Text>
            <Text style={styles.hint}>Each GBot's memory and topic notes, with secrets redacted.</Text>
          </View>
          <Switch value={notes} onValueChange={setNotes} />
        </View>
        <Text style={styles.hint}>{NEVER_IN}</Text>
        {error !== null ? <Text style={styles.error}>{error}</Text> : null}
      </GbotSheetCard>
    );
  }

  const { preview, fileBase64 } = start;

  if (imported !== null) {
    const undo = (): void =>
      run(async () => {
        await runGhostexCli(target, gbotsUndoCommand(imported.changeId));
        onChanged();
        setDone(`The import of ${imported.name} is undone: its GBots, routines and departments are removed.`);
      });
    return (
      <GbotSheetCard
        onCancel={onClose}
        footer={
          <GbotSheetButtons
            primaryLabel="Undo Import"
            canPress={!busy}
            busy={busy}
            onCancel={onClose}
            onPress={undo}
            spinner={spinner}
          />
        }
      >
        <Text style={styles.title}>{`Imported ${imported.name}`}</Text>
        <Text style={styles.body}>{`${imported.bots.length} GBots added under Chief of Staff in Main Hub.`}</Text>
        <BotRows bots={imported.bots} />
        {imported.routines > 0 ? (
          <Text style={styles.hint}>
            {`${imported.routines} routines arrived paused. Resume them in each GBot's settings.`}
          </Text>
        ) : null}
        <Lines title="Not added" lines={imported.skipped} />
        {error !== null ? <Text style={styles.error}>{error}</Text> : null}
      </GbotSheetCard>
    );
  }

  const preset = preview.kind === 'preset';
  const primary = (): void =>
    run(async () => {
      if (preset) {
        await runGhostexCli(target, gbotsPresetImportCommand(fileBase64), { timeoutMs: APPROVAL_TIMEOUT_MS });
        setDone(`Kept the preset ${preview.name}. New GBot offers it under Start from.`);
        return;
      }
      const result = await runGhostexCli(target, gbotsTeamImportCommand(fileBase64), {
        timeoutMs: APPROVAL_TIMEOUT_MS,
      });
      setImported(parseTeamImported(result.json));
      onChanged();
    });
  return (
    <GbotSheetCard
      onCancel={onClose}
      footer={
        <GbotSheetButtons
          primaryLabel={preset ? 'Keep Preset' : `Import ${preview.bots.length} GBots`}
          canPress={!busy && (preset ? !preview.hasProblems : preview.canImport)}
          busy={busy}
          onCancel={onClose}
          onPress={primary}
          spinner={spinner}
        />
      }
    >
      <Text style={styles.title}>{preset ? `Preset: ${preview.name}` : `Import ${preview.name}`}</Text>
      <Text style={styles.body}>
        {preset
          ? 'A GBot New GBot can start from. Keeping it adds no GBot yet.'
          : preview.summary.length > 0
            ? preview.summary
            : 'Nothing is added until you press Import.'}
      </Text>
      <BotRows bots={preview.bots} />
      {preview.departments.length > 0 ? (
        <Lines
          title="Departments"
          lines={preview.departments.map((department) => `${department.name}, ${department.detail}`)}
        />
      ) : null}
      {preview.routines.length > 0 ? (
        <Lines
          title="Routines (arrive paused)"
          lines={preview.routines.map((routine) => `${routine.name}: ${routine.detail}`)}
        />
      ) : null}
      {!preset ? <Text style={[styles.hint, { marginBottom: 12 }]}>{preview.approvalSentence}</Text> : null}
      {preview.lists.map((entry) => (
        <Lines key={entry.title} title={entry.title} lines={entry.lines} danger={entry.danger} />
      ))}
      {busy && !preset ? (
        <Text style={styles.waiting}>
          Adding GBots from the phone needs your OK. Approve it on your computer or phone; this waits for it.
        </Text>
      ) : null}
      {error !== null ? <Text style={styles.error}>{error}</Text> : null}
    </GbotSheetCard>
  );
}
