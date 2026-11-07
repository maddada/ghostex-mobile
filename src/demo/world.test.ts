/// <reference types="node" />
/**
 * Run with `bun test src/demo/world.test.ts`.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseMobileSummary } from '../contract/mobileSummary';
import { demoMachineRecord, isDemoMachine } from './identity';
import {
  demoTerminalAnswer,
  demoTranscript,
  execDemoCommand,
  resetDemoWorld,
  sendDemoMessage,
} from './world';

/** Same shape `createdSessionId` reads: `{ session: { sessionId } }`. */
function createdSessionId(stdout: string): string | null {
  const parsed: unknown = JSON.parse(stdout);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const session = (parsed as Record<string, unknown>).session;
  if (typeof session !== 'object' || session === null || Array.isArray(session)) return null;
  const sessionId = (session as Record<string, unknown>).sessionId;
  return typeof sessionId === 'string' && sessionId.trim().length > 0 ? sessionId : null;
}

describe('the demo computer', () => {
  test('the saved record is labeled and carries no pairing fields', () => {
    const machine = demoMachineRecord();
    assert.equal(machine.name, 'Demo computer');
    assert.equal(machine.transport, 'demo');
    assert.equal(isDemoMachine(machine), true);
    assert.equal(machine.deviceId, undefined);
    assert.equal(machine.savePassword, false);
  });

  test('the bundled summary parses into the three sample projects', () => {
    resetDemoWorld();
    const parsed = parseMobileSummary(execDemoCommand('ghostex sessions --json --mobile-summary').stdout);
    assert.ok(parsed !== null);
    assert.deepEqual(
      parsed.projects.map((project) => project.name),
      ['Atlas API', 'Side project', 'Wander'],
    );
    assert.equal(parsed.sessions.length >= 3, true);
    assert.equal(parsed.builtInFeaturesOff?.includes('voiceAgent'), true);
    const waiting = parsed.sessions.find((session) => session.sessionId === 'atlas-rate-limit');
    assert.equal(waiting?.activity, 'attention');
    assert.equal(waiting?.attentionKind, 'needsInput');
    const working = parsed.sessions.find((session) => session.sessionId === 'side-landing');
    assert.equal((working?.workingStartedAt ?? '').length > 0, true);
  });

  test('starting an agent adds a session the creation flow can open', () => {
    resetDemoWorld();
    const created = execDemoCommand("ghostex create-agent 'claude' --project-id 'side' --json");
    assert.equal(created.exitCode, 0);
    const sessionId = createdSessionId(created.stdout);
    assert.equal(typeof sessionId, 'string');
    const parsed = parseMobileSummary(execDemoCommand('ghostex sessions --json --mobile-summary').stdout);
    assert.equal(parsed?.sessions.some((session) => session.sessionId === sessionId), true);
    assert.equal(demoTranscript(sessionId ?? '').length > 0, true);
  });

  test('a sent message is kept and a command the demo does not model still exits cleanly', () => {
    resetDemoWorld();
    const reply = sendDemoMessage('wander-lisbon', 'Add a rainy-day backup');
    assert.match(reply, /Wander/);
    assert.equal(demoTranscript('wander-lisbon').at(-1)?.text, reply);
    const ports = execDemoCommand('ghostex ports --json');
    assert.equal(ports.exitCode, 0);
    assert.match(ports.stdout, /5173/);
    assert.equal(execDemoCommand('ghostex something-unknown --json').exitCode, 0);
    assert.match(demoTerminalAnswer('ls'), /README.md/);
  });
});
