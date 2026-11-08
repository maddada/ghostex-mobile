/**
 * GBot Settings > Department on the phone: which department the GBot is in (or none), whether it leads it, the
 * department's name and shared instructions with Save and Remove, and a new department the GBot moves into. Each
 * change runs at once as a `ghostex gbots` command, like the Routines tab, never waiting for the sheet's Save.
 *
 * CDXC:GBots 2026-11-09 SEE-ALSO: the DECISION in apps/desktop/src/app/window/gbot_settings_modal/department.rs (the
 * desktop's same tab), server/src/gbots/departments.rs (who may change departments: you and Chief of Staff).
 */

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { SwitchRow } from '../../components/common/SwitchRow';
import { departmentDetail, type GbotDepartment } from '../../contract/gbotDepartments';
import { GhostexStrokeWidth } from '../../theme/palette';
import { GbotChoiceChips, GbotTextField, useGbotFormStyles } from './GbotFormParts';

/** The tab's read: the departments, and where this GBot sits. */
export type GbotDepartmentState = {
  departments: GbotDepartment[];
  departmentId: string;
  isLead: boolean;
};

export type GbotDepartmentAction =
  | { kind: 'move'; departmentId: string }
  | { kind: 'lead'; lead: boolean }
  | { kind: 'edit'; departmentId: string; name: string; instructions: string }
  | { kind: 'remove'; departmentId: string }
  | { kind: 'create'; name: string };

export type GbotDepartmentViewProps = {
  name: string;
  load: () => Promise<GbotDepartmentState>;
  /** Runs `action`, then answers the tab's read as it is afterwards. */
  act: (action: GbotDepartmentAction) => Promise<GbotDepartmentState>;
};

const NONE = '';

export default function GbotDepartmentView(props: GbotDepartmentViewProps): ReactElement {
  const { appearance, styles: form } = useGbotFormStyles();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        box: {
          marginTop: 14,
          borderRadius: 8,
          borderWidth: GhostexStrokeWidth,
          borderColor: appearance.border,
          backgroundColor: appearance.card,
          paddingHorizontal: 12,
          paddingVertical: 10,
          gap: 6,
        },
        heading: { color: appearance.foreground, fontSize: 14, fontWeight: '600' },
        small: { color: appearance.muted, fontSize: 12.5, lineHeight: 17 },
        switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
        switchLabel: { flex: 1, color: appearance.foreground, fontSize: 14 },
        buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
        button: {
          borderRadius: 7,
          borderWidth: GhostexStrokeWidth,
          borderColor: appearance.border,
          backgroundColor: appearance.input,
          paddingHorizontal: 12,
          paddingVertical: 6,
        },
        danger: { borderColor: '#ef4444' },
        label: { color: appearance.foreground, fontSize: 13 },
        dangerLabel: { color: '#ef4444' },
        disabled: { opacity: 0.5 },
      }),
    [appearance],
  );
  const [state, setState] = useState<GbotDepartmentState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [newName, setNewName] = useState('');

  const show = useCallback((next: GbotDepartmentState) => {
    setState(next);
    const current = next.departments.find((department) => department.departmentId === next.departmentId);
    setName(current?.name ?? '');
    setInstructions(current?.instructions ?? '');
    setNewName('');
  }, []);

  useEffect(() => {
    let cancelled = false;
    props.load().then(
      (loaded) => {
        if (!cancelled) show(loaded);
      },
      (loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      },
    );
    return () => {
      cancelled = true;
    };
    // Read once per opening of the tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = useCallback(
    (action: GbotDepartmentAction) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      setConfirmRemove(false);
      props.act(action).then(
        (after) => {
          show(after);
          setBusy(false);
        },
        (actError: unknown) => {
          setError(actError instanceof Error ? actError.message : String(actError));
          setBusy(false);
        },
      );
    },
    [busy, props, show],
  );

  if (state === null) {
    return error === null ? (
      <ActivityIndicator style={form.loading} color={appearance.muted} />
    ) : (
      <Text style={form.error}>{error}</Text>
    );
  }
  const current = state.departments.find((department) => department.departmentId === state.departmentId);
  const options = [
    { value: NONE, label: 'None' },
    ...state.departments.map((department) => ({ value: department.departmentId, label: department.name })),
  ];
  const edited =
    current !== undefined && (name.trim() !== current.name.trim() || instructions.trim() !== current.instructions.trim());
  const button = (key: string, label: string, onPress: () => void, options?: { danger?: boolean; off?: boolean }) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy || options?.off === true}
      onPress={onPress}
      style={[
        styles.button,
        options?.danger === true ? styles.danger : null,
        busy || options?.off === true ? styles.disabled : null,
      ]}
    >
      <Text style={[styles.label, options?.danger === true ? styles.dangerLabel : null]}>{label}</Text>
    </Pressable>
  );
  const leadNote =
    current === undefined
      ? 'Chief of Staff hands it work.'
      : state.isLead
        ? `${props.name} hands ${current.name}'s GBots work and may change their instructions.`
        : current.leadName.length > 0
          ? `${current.leadName} leads ${current.name} and hands ${props.name} its work.`
          : `${current.name} has no lead, so Chief of Staff hands its GBots work.`;
  return (
    <View>
      {error !== null ? <Text style={form.error}>{error}</Text> : null}
      <View style={form.field}>
        <Text style={form.fieldLabel}>In department</Text>
        <GbotChoiceChips
          label="In department"
          options={options}
          value={state.departmentId}
          onChange={(value) => {
            if (value !== state.departmentId) act({ kind: 'move', departmentId: value });
          }}
        />
        <Text style={form.hint}>{current !== undefined ? departmentDetail(current) : leadNote}</Text>
      </View>
      {current !== undefined ? (
        <View style={styles.box}>
          <Text style={styles.heading}>{current.name}</Text>
          <SwitchRow
            value={state.isLead}
            onValueChange={(lead) => act({ kind: 'lead', lead })}
            disabled={busy}
            label={`${props.name} leads ${current.name}`}
            style={styles.switchRow}
          >
            <Text style={styles.switchLabel}>{`${props.name} leads ${current.name}`}</Text>
            <Switch value={state.isLead} disabled={busy} onValueChange={(lead) => act({ kind: 'lead', lead })} />
          </SwitchRow>
          <Text style={styles.small}>{leadNote}</Text>
          <GbotTextField label="Name" value={name} onChange={setName} />
          <GbotTextField
            label="Shared instructions"
            value={instructions}
            onChange={setInstructions}
            multiline
            placeholder="What every GBot in it follows"
            hint="Every GBot in it reads these under its own instructions."
          />
          <View style={styles.buttons}>
            {button(
              'save',
              'Save Department',
              () => act({ kind: 'edit', departmentId: current.departmentId, name, instructions }),
              { off: !edited || name.trim().length === 0 },
            )}
            {button(
              'remove',
              confirmRemove ? 'Remove? Its GBots stay' : 'Remove Department',
              () => {
                if (!confirmRemove) {
                  setConfirmRemove(true);
                  return;
                }
                act({ kind: 'remove', departmentId: current.departmentId });
              },
              { danger: true },
            )}
          </View>
        </View>
      ) : null}
      <View style={styles.box}>
        <Text style={styles.heading}>New department</Text>
        <GbotTextField label="Name" value={newName} onChange={setNewName} placeholder="e.g. Research" />
        <View style={styles.buttons}>
          {button('add', `Add and Move ${props.name}`, () => act({ kind: 'create', name: newName.trim() }), {
            off: newName.trim().length === 0,
          })}
        </View>
      </View>
    </View>
  );
}
