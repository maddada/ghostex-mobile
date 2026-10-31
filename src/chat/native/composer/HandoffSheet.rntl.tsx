/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. The sheet's shape and memory: two cards, this project here by
 * default with the button naming the agent, Change… opening the choices with the button naming the
 * project, Include closed and off, and what a handoff remembers.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { HandoffComputer, HandoffPrefs } from '../../../contract/handoff/handoff';
import { HandoffSheet } from './HandoffSheet';

const mockExport = jest.fn(async (..._args: unknown[]) => '/exports/a.md');
const mockStart = jest.fn(async (..._args: unknown[]) => undefined);
const mockSave = jest.fn();
let mockPrefs: HandoffPrefs;

const computers: HandoffComputer[] = [
  {
    machineId: 'mac',
    label: 'Macbook',
    isSource: true,
    preferredProjectId: 'own',
    missingRepository: null,
    choices: [
      { projectId: 'own', title: 'Scratch', path: '/dev/scratch', sameRepo: true, isOwn: true },
      { projectId: 'acme', title: 'acme-web', path: '/dev/acme', sameRepo: false, isOwn: false },
    ],
  },
  {
    machineId: 'studio',
    label: 'Studio',
    isSource: false,
    preferredProjectId: 'main',
    missingRepository: null,
    choices: [{ projectId: 'main', title: 'Ghostex', path: '~/Ghostex', sameRepo: true, isOwn: false }],
  },
];

jest.mock('../sessionShell', () => ({
  exportTranscript: (...args: unknown[]) => mockExport(...args),
  startHandoffConversation: (...args: unknown[]) => mockStart(...args),
  machineAgents: () => [{ agentId: 'codex', name: 'Codex' }, { agentId: 'claude', name: 'Claude' }],
  modelPickerProvider: () => null,
  projectBranch: async () => null,
  sessionRecord: () => ({ agent: 'codex' }),
  sessionTitle: () => 'Landing page ideas',
}));
jest.mock('./handoffComputers', () => ({ handoffComputersFor: () => computers }));
jest.mock('./handoffPrefsStore', () => ({
  loadHandoffPrefs: async () => mockPrefs,
  saveHandoffPrefs: (prefs: HandoffPrefs) => mockSave(prefs),
}));
jest.mock('../../../screens/terminal-screen/session-lookups', () => ({
  machineTargetFor: (id: string) => ({ id }),
}));
jest.mock('../../../inventory/store', () => ({
  useInventoryStore: { getState: () => ({ inventoriesByMachineId: {} }) },
}));
jest.mock('../../../assets/agentIcons.generated', () => ({ AGENT_ICONS: {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('./Sheet', () => ({ Sheet: ({ children }: { children: React.ReactNode }) => children }));

const defaults: HandoffPrefs = {
  card: 'agent',
  include: { commands: false, patches: false, reasoning: false },
  includeOpen: false,
  agentId: null,
  destination: null,
  destinationOpen: false,
};

async function open(prefs: Partial<HandoffPrefs> = {}, target: { provider: string; model: string; effort: string } | null = null) {
  mockPrefs = { ...defaults, ...prefs };
  await render(
    <HandoffSheet
      request={{ id: 1, target }}
      machine={{ id: 'mac' } as never}
      projectId="own"
      sessionId="s1"
      onClose={() => undefined}
      onFailure={() => undefined}
    />,
  );
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockExport.mockClear();
  mockStart.mockClear();
  mockSave.mockClear();
});

test('two cards, this project here, Include closed and off, and the button names the agent', async () => {
  await open();
  expect(screen.getByText('Handoff to an agent')).toBeTruthy();
  expect(screen.getByText('Handoff to MD')).toBeTruthy();
  expect(screen.queryByText('Advanced Handoff')).toBeNull();
  expect(screen.queryByText('Export to Markdown')).toBeNull();
  expect(screen.getByText('This project, same computer')).toBeTruthy();
  expect(screen.queryByText('Computer')).toBeNull();
  expect(screen.getByText('Messages only')).toBeTruthy();
  expect(screen.queryByText('Commands & output')).toBeNull();
  expect(screen.getByText('Handoff to Codex')).toBeTruthy();
});

test('a handoff here exports with Include off and starts beside the session', async () => {
  await open();
  await fireEvent.press(screen.getByText('Handoff to Codex'));
  await waitFor(() => expect(mockStart).toHaveBeenCalled());
  expect(mockExport.mock.calls[0]?.[3]).toEqual({ commands: false, patches: false, reasoning: false });
  expect((mockStart.mock.calls[0]?.[1] as { destination?: unknown }).destination).toBeUndefined();
  expect(mockSave.mock.calls.at(-1)?.[0]).toMatchObject({ destination: null, destinationOpen: false });
});

test('Change… opens the choices, and another project names itself and is remembered', async () => {
  await open();
  await fireEvent.press(screen.getByText('Change…'));
  expect(screen.getByText('Computer')).toBeTruthy();
  expect(screen.getByText('Hide choices')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText(/^Project /));
  await fireEvent.press(screen.getByText('acme-web · /dev/acme'));
  expect(screen.getByText('acme-web, same computer')).toBeTruthy();
  expect(screen.getByText('Use this project')).toBeTruthy();
  await fireEvent.press(screen.getByText('Handoff to acme-web'));
  await waitFor(() => expect(mockStart).toHaveBeenCalled());
  expect((mockStart.mock.calls[0]?.[1] as { destination: { projectId: string } }).destination.projectId).toBe('acme');
  expect(mockSave.mock.calls.at(-1)?.[0]).toMatchObject({
    destination: { machineId: 'mac', projectId: 'acme' },
  });
});

test('another computer is named on the button', async () => {
  await open();
  await fireEvent.press(screen.getByText('Change…'));
  await fireEvent.press(screen.getByLabelText(/^Computer /));
  await fireEvent.press(screen.getByText('Studio'));
  expect(screen.getByText('Ghostex on Studio')).toBeTruthy();
  expect(screen.getByText('Handoff to Ghostex on Studio')).toBeTruthy();
});

test('a remembered destination opens showing where it goes', async () => {
  await open({ destination: { machineId: 'studio', projectId: 'main' } });
  expect(screen.getByText('Ghostex on Studio')).toBeTruthy();
  expect(screen.getByText('Handoff to Ghostex on Studio')).toBeTruthy();
});

test('a remembered destination that no longer applies falls back to this project here', async () => {
  for (const destination of [
    { machineId: 'gone', projectId: 'main' },
    { machineId: 'mac', projectId: 'gone' },
    { machineId: 'mac', projectId: 'own' },
  ]) {
    await open({ destination });
    expect(screen.getByText('This project, same computer')).toBeTruthy();
    expect(screen.getByText('Handoff to Codex')).toBeTruthy();
  }
});

test('the card, the agent and Include come back as they were left', async () => {
  await open({
    card: 'markdown',
    agentId: 'claude',
    includeOpen: true,
    include: { commands: true, patches: false, reasoning: false },
  });
  expect(screen.getByText('Export')).toBeTruthy();
  expect(screen.getByLabelText('Commands & output').props.value).toBe(true);
  await fireEvent.press(screen.getByText('Handoff to an agent'));
  expect(screen.getByText('Handoff to Claude')).toBeTruthy();
  expect(mockSave.mock.calls.at(-1)?.[0]).toMatchObject({ card: 'agent' });
});

test('changing Include is saved', async () => {
  await open();
  await fireEvent.press(screen.getByText('Include'));
  expect(mockSave.mock.calls.at(-1)?.[0]).toMatchObject({ includeOpen: true });
  await fireEvent(screen.getByLabelText('File changes'), 'valueChange', true);
  expect(mockSave.mock.calls.at(-1)?.[0]).toMatchObject({
    include: { commands: false, patches: true, reasoning: false },
  });
});

test("the model picker's handoff opens here and is not remembered", async () => {
  await open({ destination: { machineId: 'studio', projectId: 'main' } }, { provider: 'codex', model: 'm', effort: '' });
  expect(screen.getByText('This project, same computer')).toBeTruthy();
  await fireEvent.press(screen.getByText('Handoff to Codex'));
  await waitFor(() => expect(mockStart).toHaveBeenCalled());
  expect(mockSave).not.toHaveBeenCalled();
});
