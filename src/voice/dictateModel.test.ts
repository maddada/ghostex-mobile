/// <reference types="node" />
/** Run with `bun test src/voice/dictateModel.test.ts` from apps/mobile/app. */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  dictateEngines,
  engineCaption,
  engineStatusLine,
  hexCaption,
  isUnknownRoute,
  type DictateEngine,
  type DictateOverview,
  type HexView,
} from './dictateModel';

const overview = (patch: Partial<DictateOverview> = {}): DictateOverview => ({
  settings: {
    engine: 'hex',
    language: 'auto',
  },
  engine: { engine: 'hex', label: 'Hex', ready: false, problem: null },
  keys: { xai: { configured: false, unreadable: false }, openai: { configured: false, unreadable: false } },
  languages: [{ code: 'auto', label: 'Auto-detect' }],
  ...patch,
});

describe('what the phone says about the engine', () => {
  test('a computer whose Ghostex still has its own engine is told to update', () => {
    const old = overview({ engine: { ...overview().engine, engine: 'local', label: 'Local, Parakeet v3' } });
    assert.match(engineCaption(old, 'MacBook Pro'), /Update Ghostex on MacBook Pro/);
  });

  test('a cloud engine names the computer whose key it uses, or the missing key', () => {
    const xai = overview({
      settings: { ...overview().settings, engine: 'xai' },
      engine: { ...overview().engine, engine: 'xai', label: 'xAI speech to text' },
    });
    assert.match(engineCaption(xai, 'Studio PC'), /Studio PC has no xAI key yet/);
    const keyed = { ...xai, keys: { ...xai.keys, xai: { configured: true, unreadable: false } } };
    assert.equal(engineCaption(keyed, 'Studio PC'), 'Recordings go to xAI with the key saved on Studio PC.');
  });

  test('the Dictate menu never says Click', () => {
    const engine: DictateEngine = {
      engine: 'hex',
      label: 'Hex',
      ready: false,
      problem: { code: 'hexNotRunning', message: "Hex isn't running on this computer. Click Open." },
    };
    assert.doesNotMatch(engineStatusLine(engine, 'MacBook Pro'), /Click/);
    assert.equal(engineStatusLine({ ...engine, ready: true, problem: null }, 'MacBook Pro'), 'Transcribes on MacBook Pro.');
  });

  test('a computer without the routes reads as one to update', () => {
    assert.equal(isUnknownRoute({ code: 'notFound', message: 'Unknown Dictate route.' }), true);
    assert.equal(isUnknownRoute({ code: 'unreachable', message: "Couldn't reach Ghostex." }), false);
  });
});

describe('Hex', () => {
  const hex = (state: HexView['state'], extra: Partial<HexView> = {}): HexView => ({
    available: state !== 'unsupported',
    state,
    version: null,
    olderVersion: null,
    models: [],
    model: null,
    ready: false,
    problem: null,
    downloadUrl: 'https://github.com/anomalyco/hex#downloads',
    ...extra,
  });

  test('the picker offers Hex only where the computer says Hex 3 ships', () => {
    assert.deepEqual(dictateEngines({ hex: undefined }).map((engine) => engine.value), ['openai', 'xai']);
    assert.deepEqual(dictateEngines({ hex: hex('unsupported') }).map((engine) => engine.value), ['openai', 'xai']);
    assert.deepEqual(
      dictateEngines({ hex: hex('notRunning') }).map((engine) => engine.value),
      ['hex', 'openai', 'xai'],
      'Hex first, as the recommended engine',
    );
  });

  test('the caption says where the user stands, in the phone\'s words', () => {
    assert.match(hexCaption(hex('notInstalled'), 'Mac'), /^Hex 3 isn't installed on Mac\. Install Hex, then open it on Mac, allow the microphone/);
    assert.equal(
      hexCaption(hex('notInstalled', { olderVersion: '0.6.2' }), 'Mac'),
      "Mac has Hex 0.6.2, which can't transcribe for Ghostex. Install Hex 3 there.",
    );
    assert.match(hexCaption(hex('notRunning'), 'Mac'), /^Hex isn't running on Mac\. Open Hex there, then check again\. .*Open at login/);
    assert.equal(
      hexCaption(hex('ready', { version: '3.3.0', ready: true, model: 'a', models: [{ id: 'a', name: 'Parakeet v3', languages: ['en'], supportsLanguageDetection: false }] }), 'Mac'),
      'Hex 3.3.0 on Mac transcribes with Parakeet v3. Recordings stay on Mac.',
    );
    assert.equal(
      hexCaption(hex('ready', { problem: { code: 'hexNoModels', message: 'Hex has no model ready.' } }), 'Mac'),
      'Hex on Mac has no model ready. Download one in Hex there, then check again.',
    );
    assert.match(hexCaption(undefined, 'Mac'), /too old for Hex/);
  });

  test('the chat menu line says what to do on the computer', () => {
    const engine = (code: string): DictateEngine => ({
      engine: 'hex',
      label: 'Hex',
      ready: false,
      problem: { code, message: 'gxserver words.' },
    });
    assert.equal(engineStatusLine(engine('hexNotRunning'), 'Mac'), "Hex isn't running on Mac. Open Hex there.");
    assert.equal(engineStatusLine(engine('hexNotInstalled'), 'Mac'), "Hex 3 isn't installed on Mac. Install it in Voice settings.");
    assert.match(engineStatusLine(engine('hexModelNotReady'), 'Mac'), /no ready model/);
  });
});
